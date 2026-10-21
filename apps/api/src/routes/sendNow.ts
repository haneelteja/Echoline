import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  createAdminClient,
  decryptCredentials,
  encryptCredentials,
  envelopeToRow,
  loadMasterKey,
  rowToEnvelope,
  type ContactRow,
  type ProjectRow,
  type TemplateRow,
} from "@echoline/db";
import {
  buildOpenPixelUrl,
  buildUnsubscribeUrl,
  getEmailSender,
  getWhatsAppTemplateSender,
  getWhatsAppTextSender,
  makeRewriteLink,
  refreshGoogleToken,
  refreshMicrosoftToken,
  TEXT_ONLY_WHATSAPP_PROVIDERS,
  type WhatsAppProviderId,
} from "@echoline/providers";
import { buildUnsubscribeHeaders, emailHTML, fill, fillPlainText, normPhone, STAGE_STATUS_KEYS, validEmail } from "@echoline/core";
import { sendDbError } from "../errors.js";
import { isTestSendMode, testSendEmail, testSendWhatsApp } from "../testSendMode.js";

const sendNowInput = z.object({
  channel: z.enum(["email", "whatsapp"]),
  templateId: z.string().uuid(),
});

function masterKey() {
  return loadMasterKey(process.env.CREDENTIAL_VAULT_MASTER_KEY);
}

function trackingConfig() {
  return { secret: process.env.TRACKING_SIGNING_SECRET ?? "", baseUrl: process.env.API_PUBLIC_URL ?? "" };
}

async function fetchGalleryUrls(db: ReturnType<typeof createAdminClient>, assetIds: string[] | null | undefined): Promise<string[]> {
  if (!assetIds?.length) return [];
  const { data } = await db.from("kb_assets").select("id, url").in("id", assetIds);
  const byId = new Map(((data as { id: string; url: string }[]) ?? []).map((a) => [a.id, a.url]));
  // Preserve selection order; silently drops any since-deleted asset rather
  // than failing the whole send over a missing image.
  return assetIds.map((id) => byId.get(id)).filter((u): u is string => Boolean(u));
}

async function fetchHeaderMedia(
  db: ReturnType<typeof createAdminClient>,
  assetId: string | null | undefined
): Promise<{ url: string; kind: "image" | "document"; name: string } | null> {
  if (!assetId) return null;
  const { data } = await db.from("kb_assets").select("url, kind, name").eq("id", assetId).maybeSingle();
  return (data as { url: string; kind: "image" | "document"; name: string } | null) ?? null;
}

// Same refresh-unconditionally pattern as apps/worker's emailWorker.ts — kept
// as a small duplicate here rather than touching that already-verified
// worker code for this unrelated feature.
async function ensureFreshOAuthToken(
  db: ReturnType<typeof createAdminClient>,
  conn: { id: string; provider: string },
  credentials: Record<string, string>
): Promise<void> {
  if (conn.provider !== "gmail" && conn.provider !== "outlook") return;
  const envPrefix = conn.provider === "gmail" ? "GOOGLE" : "MICROSOFT";
  const clientId = process.env[`${envPrefix}_OAUTH_CLIENT_ID`];
  const clientSecret = process.env[`${envPrefix}_OAUTH_CLIENT_SECRET`];
  if (!clientId || !clientSecret || !credentials.refreshToken) return;
  try {
    const tokens =
      conn.provider === "gmail"
        ? await refreshGoogleToken({ clientId, clientSecret }, credentials.refreshToken)
        : await refreshMicrosoftToken({ clientId, clientSecret }, credentials.refreshToken);
    credentials.accessToken = tokens.accessToken;
    if (tokens.refreshToken) credentials.refreshToken = tokens.refreshToken;
    const envelope = encryptCredentials(JSON.stringify(credentials), masterKey());
    await db.from("provider_connections").update(envelopeToRow(envelope)).eq("id", conn.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.from("provider_connections").update({ status: "needs_reconnect", needs_reconnect_reason: `Token refresh failed: ${message}` }).eq("id", conn.id);
    throw new Error(`OAuth token refresh failed for ${conn.provider}: ${message}`);
  }
}

/**
 * Claims this (contact, channel, step) slot the exact same way the automated
 * scheduler does (claim_message_send — see 0004_claim_message_send.sql),
 * after checking the same daily-cap accounting it uses (messages
 * queued-or-sent today for this channel). A manual send is no longer a
 * side-channel the scheduler is unaware of: it counts toward today's cap and
 * occupies the same unique (project,contact,channel,step) slot, so the
 * scheduler can never double-send a step this route already claimed.
 */
async function checkDailyCapAndClaim(
  db: ReturnType<typeof createAdminClient>,
  opts: { orgId: string; projectId: string; contactId: string; channel: "em" | "wa"; step: number; dailyCap: number }
): Promise<{ ok: true; messageId: string } | { ok: false; reason: "daily_cap_reached" | "already_sent" }> {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const { count } = await db
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("project_id", opts.projectId)
    .eq("channel", opts.channel)
    .gte("queued_at", todayStart.toISOString());
  if ((count ?? 0) >= opts.dailyCap) return { ok: false, reason: "daily_cap_reached" };

  const { data: claimed, error } = await db.rpc("claim_message_send", {
    p_org_id: opts.orgId,
    p_project_id: opts.projectId,
    p_contact_id: opts.contactId,
    p_channel: opts.channel,
    p_step: opts.step,
  });
  if (error) throw error;
  const claimedId = (claimed as { id?: string } | null)?.id;
  if (!claimedId) return { ok: false, reason: "already_sent" };
  return { ok: true, messageId: claimedId };
}

/** Advances the lead exactly as an automated send would — same newStage/
 * newStatus derivation as emailWorker.ts/whatsappWorker.ts — plus the
 * em_manual_last/wa_manual_last marker so the Leads table can show this was
 * a manual send. Firing this is what lets the scheduler pick up and send the
 * next follow-up on schedule afterward, instead of the lead being stuck. */
async function markSent(
  db: ReturnType<typeof createAdminClient>,
  opts: {
    messageId: string;
    contactId: string;
    channel: "em" | "wa";
    step: number;
    totalSteps: number;
    providerMessageId: string;
    providerConnectionId: string;
    orgId: string;
    projectId: string;
    templateId: string;
    testMode: boolean;
  }
): Promise<void> {
  const newStage = opts.step + 1;
  const newStatus = newStage >= opts.totalSteps ? "completed" : STAGE_STATUS_KEYS[newStage];
  const prefix = opts.channel;

  await Promise.all([
    db
      .from("messages")
      .update({ status: "sent", provider_message_id: opts.providerMessageId, provider_connection_id: opts.providerConnectionId, sent_at: new Date().toISOString() })
      .eq("id", opts.messageId),
    db
      .from("contacts")
      .update({
        [`${prefix}_stage`]: newStage,
        [`${prefix}_status`]: newStatus,
        [`${prefix}_last`]: new Date().toISOString(),
        [`${prefix}_track`]: "sent",
        [`${prefix}_manual_last`]: true,
      })
      .eq("id", opts.contactId),
    db.from("message_events").insert({
      org_id: opts.orgId,
      project_id: opts.projectId,
      message_id: opts.messageId,
      contact_id: opts.contactId,
      channel: opts.channel,
      event_type: "sent",
      payload: { manual: true, templateId: opts.templateId, step: opts.step, providerMessageId: opts.providerMessageId, test: opts.testMode },
    }),
  ]);
}

async function markFailed(
  db: ReturnType<typeof createAdminClient>,
  opts: { messageId: string | null; contactId: string; channel: "em" | "wa"; step: number; orgId: string; projectId: string; templateId: string; error: string }
): Promise<void> {
  await Promise.all([
    opts.messageId ? db.from("messages").update({ status: "failed" }).eq("id", opts.messageId) : Promise.resolve(),
    db.from("message_events").insert({
      org_id: opts.orgId,
      project_id: opts.projectId,
      message_id: opts.messageId,
      contact_id: opts.contactId,
      channel: opts.channel,
      event_type: "failed",
      payload: { manual: true, templateId: opts.templateId, step: opts.step, error: opts.error },
    }),
  ]);
}

/**
 * Manual, instant single-lead send. Used to be fully decoupled from the
 * sequence engine; now claims the same (contact,channel,step) slot and
 * counts toward the same daily cap as an automated send (see
 * checkDailyCapAndClaim/markSent above), so a manual send of a lead's next
 * due step is indistinguishable from the scheduler having sent it — the
 * scheduler naturally continues with the next follow-up afterward.
 */
export const sendNowRoutes: FastifyPluginAsync = async (app) => {
  app.post("/projects/:projectId/contacts/:contactId/send-now", async (req, reply) => {
    const { projectId, contactId } = req.params as { projectId: string; contactId: string };
    const body = sendNowInput.parse(req.body);

    // Runs through the caller's own RLS for the read-side lookups (so a
    // viewer/project_viewer gets the right 403 from can_write_project via the
    // templates/contacts policies), then an admin client for the actual send
    // + credential decrypt, same split emailWorker.ts/whatsappWorker.ts use.
    const [{ data: contact, error: contactErr }, { data: project, error: projErr }, { data: template, error: tmplErr }] = await Promise.all([
      req.supabase.from("contacts").select("*").eq("project_id", projectId).eq("id", contactId).maybeSingle(),
      req.supabase.from("projects").select("*").eq("id", projectId).maybeSingle(),
      req.supabase
        .from("templates")
        .select("*")
        .eq("project_id", projectId)
        .eq("id", body.templateId)
        .eq("channel", body.channel)
        .maybeSingle(),
    ]);
    if (contactErr) return sendDbError(reply, contactErr);
    if (projErr) return sendDbError(reply, projErr);
    if (tmplErr) return sendDbError(reply, tmplErr);
    if (!contact) return reply.code(404).send({ error: "not_found", message: "Contact not found" });
    if (!project) return reply.code(404).send({ error: "not_found", message: "Project not found" });
    if (!template) return reply.code(404).send({ error: "not_found", message: "Template not found" });

    const c = contact as ContactRow;
    const p = project as ProjectRow;
    const t = template as TemplateRow;
    const db = createAdminClient();
    const channelKind: "em" | "wa" = body.channel === "email" ? "em" : "wa";

    const kind = body.channel === "email" ? "email" : "whatsapp";
    const { data: conn, error: connErr } = await db
      .from("provider_connections")
      .select("*")
      .eq("project_id", projectId)
      .eq("kind", kind)
      .eq("status", "connected")
      .maybeSingle();
    if (connErr) return sendDbError(reply, connErr);
    if (!conn) return reply.code(400).send({ error: "no_connection", message: `No connected ${kind} provider for this project` });

    const { data: seqRow, error: seqErr } = await db.from("sequence_settings").select("daily_cap, em, wa").eq("project_id", projectId).maybeSingle();
    if (seqErr) return sendDbError(reply, seqErr);
    const seq = seqRow as { daily_cap: number; em: { steps: unknown[] }; wa: { steps: unknown[] } } | null;
    const dailyCap = seq?.daily_cap ?? 50;
    const totalSteps = seq?.[channelKind]?.steps?.length ?? t.step + 1;

    const claim = await checkDailyCapAndClaim(db, { orgId: p.org_id, projectId, contactId, channel: channelKind, step: t.step, dailyCap });
    if (!claim.ok) {
      return reply.code(claim.reason === "daily_cap_reached" ? 429 : 409).send({
        error: claim.reason,
        message:
          claim.reason === "daily_cap_reached"
            ? `This project's daily ${kind} cap (${dailyCap}) has already been reached today.`
            : "This step has already been sent to this contact.",
      });
    }
    const messageId = claim.messageId;

    const projectBrand = { name: p.name, brand: p.brand, senderName: p.sender_name, website: p.website, waNumber: p.wa_number, accent: p.accent };

    try {
      if (body.channel === "email") {
        if (!validEmail(c.email)) return reply.code(400).send({ error: "validation_error", message: "Contact has no valid email" });
        const sender = getEmailSender((conn as any).provider);
        if (!sender) return reply.code(400).send({ error: "no_sender", message: `No sender implemented for provider ${(conn as any).provider}` });

        // fill()'s FillContext expects camelCase (contactPerson), not the raw
        // ContactRow's snake_case contact_person — see the identical fix in
        // apps/worker/src/workers/emailWorker.ts.
        const contactCtx = { name: c.name, contactPerson: c.contact_person, area: c.area, category: c.category };
        const ctx = { project: projectBrand, contact: contactCtx, template: { body: t.body ?? "", categoryLines: t.category_lines ?? {} } };
        const tc = trackingConfig();
        const unsubscribeUrl = buildUnsubscribeUrl(tc, messageId);
        const galleryUrls = await fetchGalleryUrls(db, t.gallery_asset_ids);
        const html = emailHTML(
          { body: t.body ?? "" },
          ctx,
          { logoUrl: null, galleryUrls },
          { unsubscribeUrl, trackingPixelUrl: buildOpenPixelUrl(tc, messageId), rewriteLink: makeRewriteLink(tc, messageId) }
        );
        const text = fillPlainText(t.body ?? "", ctx, { unsubscribeUrl });
        let subject = fill(t.subject, ctx);
        const headers = buildUnsubscribeHeaders(unsubscribeUrl);

        // Testing-phase safety valve: redirect to a fixed test inbox instead
        // of the real lead — see testSendMode.ts.
        const testMode = isTestSendMode();
        let toEmail = c.email!;
        if (testMode) {
          subject = `[TEST → ${c.name} <${c.email}>] ${subject}`;
          toEmail = testSendEmail();
        }

        const credentials = JSON.parse(decryptCredentials(rowToEnvelope(conn as any), masterKey()));
        await ensureFreshOAuthToken(db, conn as any, credentials);
        const { data: channelSettings } = await db.from("channel_settings").select("email").eq("project_id", projectId).maybeSingle();
        const emailSettings = ((channelSettings as any)?.email ?? {}) as Record<string, string>;
        const fromEmail = emailSettings.fromEmail || credentials.fromEmail || (conn as any).account_label;
        if (!fromEmail) return reply.code(400).send({ error: "no_sender_email", message: "No from-email configured for this project's email connection" });

        const result = await sender(credentials, { from: fromEmail, to: toEmail, subject, html, text, headers });

        await markSent(db, {
          messageId,
          contactId,
          channel: "em",
          step: t.step,
          totalSteps,
          providerMessageId: result.providerMessageId,
          providerConnectionId: (conn as any).id,
          orgId: p.org_id,
          projectId,
          templateId: body.templateId,
          testMode,
        });
        return { ok: true };
      }

      // WhatsApp
      const phone = normPhone(c.phone ?? null);
      if (!phone) return reply.code(400).send({ error: "validation_error", message: "Contact has no valid WhatsApp number" });
      const providerId = (conn as any).provider as WhatsAppProviderId;
      const credentials = JSON.parse(decryptCredentials(rowToEnvelope(conn as any), masterKey()));
      const fillCtx = {
        project: projectBrand,
        contact: { name: c.name, contactPerson: c.contact_person, area: c.area, category: c.category },
        template: { categoryLines: t.category_lines ?? {} },
      };

      // Testing-phase safety valve: redirect to a fixed test number instead
      // of the real lead — see testSendMode.ts.
      const testMode = isTestSendMode();
      const toPhone = testMode ? testSendWhatsApp() : phone;

      let providerMessageId: string;
      if (TEXT_ONLY_WHATSAPP_PROVIDERS.has(providerId)) {
        const sender = getWhatsAppTextSender(providerId);
        if (!sender) return reply.code(400).send({ error: "no_sender", message: `No text sender implemented for provider ${providerId}` });
        const text = testMode ? `[TEST → ${c.name} ${phone}]\n${fill(t.body, fillCtx)}` : fill(t.body, fillCtx);
        // Unlike a Meta template header (capped at one attachment), a
        // free-text provider has no such limit — the text plus the first
        // gallery item go out together in one message, then each remaining
        // item follows as its own message.
        const galleryUrls = await fetchGalleryUrls(db, t.gallery_asset_ids);
        const sends = galleryUrls.length
          ? [{ text, mediaUrl: galleryUrls[0] }, ...galleryUrls.slice(1).map((mediaUrl) => ({ text: "", mediaUrl }))]
          : [{ text, mediaUrl: undefined }];
        providerMessageId = "";
        for (const s of sends) {
          const result = await sender(credentials, { to: toPhone, text: s.text, mediaUrl: s.mediaUrl });
          if (!providerMessageId) providerMessageId = result.providerMessageId;
        }
      } else {
        if (t.meta_status !== "Approved") {
          return reply
            .code(400)
            .send({ error: "template_not_approved", message: `Template "${t.name ?? t.meta_name ?? "untitled"}" is not Approved (status: ${t.meta_status ?? "Draft"})` });
        }
        if (!t.meta_name) return reply.code(400).send({ error: "no_meta_name", message: "Template has no registered Meta template name" });
        const sender = getWhatsAppTemplateSender(providerId);
        if (!sender) return reply.code(400).send({ error: "no_sender", message: `No sender implemented for provider ${providerId}` });

        const { data: waTemplate } = await db.from("wa_templates").select("variable_map").eq("template_id", t.id).maybeSingle();
        const variableMap = ((waTemplate as { variable_map?: string[] } | null)?.variable_map ?? []) as string[];
        const components =
          variableMap.length > 0
            ? [{ type: "body" as const, parameters: variableMap.map((key) => ({ type: "text" as const, text: fill(`{{${key}}}`, fillCtx) })) }]
            : undefined;
        const header = await fetchHeaderMedia(db, t.header_asset_id);
        const result = await sender(credentials, {
          to: toPhone,
          templateName: t.meta_name,
          language: "en",
          components,
          mediaUrls: header ? [header.url] : undefined,
          mediaKind: header?.kind,
          mediaFilename: header?.kind === "document" ? header.name : undefined,
        });
        providerMessageId = result.providerMessageId;
      }

      await markSent(db, {
        messageId,
        contactId,
        channel: "wa",
        step: t.step,
        totalSteps,
        providerMessageId,
        providerConnectionId: (conn as any).id,
        orgId: p.org_id,
        projectId,
        templateId: body.templateId,
        testMode,
      });
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await markFailed(db, { messageId, contactId, channel: channelKind, step: t.step, orgId: p.org_id, projectId, templateId: body.templateId, error: message });
      return reply.code(502).send({ error: "send_failed", message });
    }
  });
};
