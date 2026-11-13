import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { createAdminClient, decryptCredentials, encryptCredentials, envelopeToRow, loadMasterKey, rowToEnvelope, type ProjectRow } from "@echoline/db";
import { buildOpenPixelUrl, buildUnsubscribeUrl, getEmailSender, makeRewriteLink, refreshGoogleToken, refreshMicrosoftToken, type EmailAttachment } from "@echoline/providers";
import { emailHTML, emailHTMLFromRaw, fill, fillPlainText, fillPlainTextFromRaw } from "@echoline/core";
import { sendDbError } from "../errors.js";

function masterKey() {
  return loadMasterKey(process.env.CREDENTIAL_VAULT_MASTER_KEY);
}

function trackingConfig() {
  return { secret: process.env.TRACKING_SIGNING_SECRET ?? "", baseUrl: process.env.API_PUBLIC_URL ?? "" };
}

// Same refresh-unconditionally pattern as sendNow.ts/emailWorker.ts — kept as
// a small duplicate here rather than extracting a shared helper for one more
// call site.
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

const input = z.object({
  to: z.string().email(),
  subject: z.string().min(1),
  body: z.string().min(1),
  categoryLines: z.record(z.string()).optional(),
  galleryAssetIds: z.array(z.string().uuid()).optional(),
  cc: z.string().email().optional(),
  replyTo: z.string().email().optional(),
  isHtml: z.boolean().optional(),
  fromConnectionId: z.string().uuid().optional(),
  fromEmail: z.string().email().optional(),
});

const SAMPLE_CONTACT = { name: "Acme Corp", contactPerson: null as string | null, area: "Gachibowli", category: "Restaurant" };

/**
 * Sends the email editor's current (possibly unsaved) draft to an address
 * the editor types in, so they can see real inbox rendering before saving —
 * distinct from sendNow.ts's per-lead send, which always needs a saved
 * template row plus a real contact. Uses the same placeholder contact data
 * as the in-editor preview. Deliberately NOT redirected by TEST_SEND_MODE —
 * that safety valve protects real leads from accidental sends; here the
 * admin chose this address on purpose, so it should go exactly there.
 *
 * Reads provider_connections through the caller's own req.supabase (RLS
 * admin-gated, same reasoning as aiTemplates.ts) so a non-admin simply gets
 * "no_connection" rather than a working send.
 */
export const templateTestSendRoutes: FastifyPluginAsync = async (app) => {
  app.post("/projects/:id/templates/send-test-email", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = input.parse(req.body);

    const { data: project, error: projErr } = await req.supabase.from("projects").select("*").eq("id", id).maybeSingle();
    if (projErr) return sendDbError(reply, projErr);
    if (!project) return reply.code(404).send({ error: "not_found" });
    const p = project as ProjectRow;

    // email is no longer limited to one connected row per org (see
    // templates.from_connection_id) — the editor's draft carries its own
    // fromConnectionId choice through body.fromConnectionId.
    const { data: conns, error: connErr } = await req.supabase
      .from("provider_connections")
      .select("*")
      .eq("org_id", p.org_id)
      .eq("kind", "email")
      .eq("status", "connected");
    if (connErr) return sendDbError(reply, connErr);
    const candidates = (conns as any[]) ?? [];
    const conn = body.fromConnectionId
      ? candidates.find((x) => x.id === body.fromConnectionId)
      : candidates.length === 1
        ? candidates[0]
        : undefined;
    if (!conn) {
      return reply.code(400).send({
        error: "no_connection",
        message:
          candidates.length > 1 && !body.fromConnectionId
            ? "Multiple email connections are active for this organization — pick a From connection first"
            : "No connected email provider for this organization",
      });
    }

    const c = conn as { id: string; provider: string; account_label: string | null } & Record<string, unknown>;
    const sender = getEmailSender(c.provider);
    if (!sender) return reply.code(400).send({ error: "no_sender", message: `No sender implemented for provider ${c.provider}` });

    const projectBrand = { name: p.name, brand: p.brand, senderName: p.sender_name, website: p.website, waNumber: p.wa_number, accent: p.accent };
    const ctx = { project: projectBrand, contact: SAMPLE_CONTACT, template: { body: body.body, categoryLines: body.categoryLines ?? {} } };

    // Real file attachments, not the inline/embedded images emailHTML()
    // deliberately stopped rendering (see template.ts's Promotions-tab
    // comment) — a broken/unreachable/oversized asset is skipped rather than
    // failing the whole test send. 8MB/file cap mirrors emailWorker.ts/
    // sendNow.ts, well under every connected provider's own limit.
    const attachments: EmailAttachment[] = [];
    if (body.galleryAssetIds?.length) {
      const { data: assetRows } = await req.supabase.from("kb_assets").select("id, name, mime_type, url").in("id", body.galleryAssetIds);
      const byId = new Map(((assetRows as { id: string; name: string; mime_type: string; url: string }[]) ?? []).map((a) => [a.id, a]));
      for (const aid of body.galleryAssetIds) {
        const a = byId.get(aid);
        if (!a) continue;
        try {
          const res = await fetch(a.url);
          if (!res.ok) continue;
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.byteLength > 8 * 1024 * 1024) continue;
          attachments.push({ filename: a.name, contentType: a.mime_type, content: buf.toString("base64") });
        } catch {
          continue;
        }
      }
    }

    const trackingKey = `test-${id}-${Date.now()}`;
    const tc = trackingConfig();
    const unsubscribeUrl = buildUnsubscribeUrl(tc, trackingKey);
    const html = body.isHtml
      ? emailHTMLFromRaw(body.body, ctx, { unsubscribeUrl })
      : emailHTML(
          { body: body.body },
          ctx,
          { logoUrl: null, galleryUrls: [] },
          { unsubscribeUrl, trackingPixelUrl: buildOpenPixelUrl(tc, trackingKey), rewriteLink: makeRewriteLink(tc, trackingKey) }
        );
    const text = body.isHtml ? fillPlainTextFromRaw(body.body, ctx, { unsubscribeUrl }) : fillPlainText(body.body, ctx, { unsubscribeUrl });
    const subject = `[TEST] ${fill(body.subject, ctx)}`;

    const db = createAdminClient();
    const credentials = JSON.parse(decryptCredentials(rowToEnvelope(conn as never), masterKey()));
    await ensureFreshOAuthToken(db, c, credentials);
    const { data: channelSettings } = await db.from("channel_settings").select("email").eq("project_id", id).maybeSingle();
    const emailSettings = ((channelSettings as { email?: Record<string, string> } | null)?.email ?? {}) as Record<string, string>;
    const fromEmail = body.fromEmail || emailSettings.fromEmail || credentials.fromEmail || c.account_label;
    if (!fromEmail) return reply.code(400).send({ error: "no_sender_email", message: "No from-email configured for this project's email connection" });

    try {
      await sender(credentials, { from: fromEmail, to: body.to, cc: body.cc, replyTo: body.replyTo ?? p.reply_to_email ?? undefined, subject, html, text, attachments });
      return { ok: true };
    } catch (err) {
      return reply.code(502).send({ error: "send_failed", message: err instanceof Error ? err.message : String(err) });
    }
  });
};
