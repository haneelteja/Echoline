import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { createAdminClient, decryptCredentials, loadMasterKey, rowToEnvelope } from "@echoline/db";
import { verifyMetaSignature, verifySendGridSignature, verifySvixSignature, verifyTwilioSignature } from "@echoline/providers";
import { normPhone } from "@echoline/core";

function masterKey() {
  return loadMasterKey(process.env.CREDENTIAL_VAULT_MASTER_KEY);
}

function rawBodyOf(req: FastifyRequest): string {
  return (req as unknown as { rawBody?: string }).rawBody ?? "";
}

const OPT_OUT_KEYWORDS = new Set(["stop", "unsubscribe", "cancel", "end", "quit", "opt out", "optout"]);
function isOptOutText(text: string): boolean {
  return OPT_OUT_KEYWORDS.has(text.trim().toLowerCase());
}

interface MessageContext {
  id: string;
  org_id: string;
  project_id: string;
  contact_id: string;
  channel: "em" | "wa";
  provider_connection_id: string | null;
}

async function findMessageByProviderMessageId(db: ReturnType<typeof createAdminClient>, providerMessageId: string): Promise<MessageContext | null> {
  const { data } = await db
    .from("messages")
    .select("id, org_id, project_id, contact_id, channel, provider_connection_id")
    .eq("provider_message_id", providerMessageId)
    .maybeSingle();
  return (data as MessageContext | null) ?? null;
}

async function decryptConnectionCredentials(db: ReturnType<typeof createAdminClient>, connectionId: string): Promise<Record<string, string> | null> {
  const { data: conn } = await db.from("provider_connections").select("*").eq("id", connectionId).maybeSingle();
  if (!conn) return null;
  try {
    return JSON.parse(decryptCredentials(rowToEnvelope(conn as any), masterKey()));
  } catch {
    return null;
  }
}

/**
 * Template status-update events are WABA-level (one Meta App's webhook
 * covers every WABA subscribed to it), so there's no phone number to match —
 * only entry.id, the WABA ID itself. wabaId lives in each connection's
 * encrypted credentials, not in plaintext anywhere queryable, so this
 * decrypts every Meta connection to find the match. Fine at today's scale
 * (a handful of connections); revisit if that ever stops being true.
 */
async function resolveProjectByWabaId(db: ReturnType<typeof createAdminClient>, wabaId: string): Promise<{ id: string; org_id: string } | null> {
  const { data: connections } = await db.from("provider_connections").select("*").eq("kind", "whatsapp").eq("provider", "meta");
  for (const conn of (connections as any[]) ?? []) {
    try {
      const credentials = JSON.parse(decryptCredentials(rowToEnvelope(conn), masterKey()));
      if (credentials.wabaId === wabaId) {
        const { data: project } = await db.from("projects").select("id, org_id").eq("id", conn.project_id).maybeSingle();
        if (project) return project as { id: string; org_id: string };
      }
    } catch {
      // skip a connection we can't decrypt
    }
  }
  return null;
}

async function recordEvent(
  db: ReturnType<typeof createAdminClient>,
  opts: {
    orgId: string;
    projectId: string;
    messageId: string | null;
    contactId: string;
    channel: "em" | "wa";
    eventType: string;
    payload?: Record<string, unknown>;
    messageStatus?: string;
    contactUpdate?: Record<string, unknown>;
  }
) {
  await db.from("message_events").insert({
    org_id: opts.orgId,
    project_id: opts.projectId,
    message_id: opts.messageId,
    contact_id: opts.contactId,
    channel: opts.channel,
    event_type: opts.eventType,
    payload: opts.payload ?? {},
  });
  if (opts.messageStatus && opts.messageId) {
    await db.from("messages").update({ status: opts.messageStatus }).eq("id", opts.messageId);
  }
  if (opts.contactUpdate) {
    await db.from("contacts").update(opts.contactUpdate).eq("id", opts.contactId);
  }
}

/**
 * Public routes hit directly by provider webhooks — never behind the /v1
 * auth prefix (providers carry no Supabase session). Each handler verifies
 * its own provider's signature before trusting the payload; an unverified or
 * unrecognized request gets a 200 (so the provider doesn't retry-storm us)
 * but writes nothing.
 */
export const webhookRoutes: FastifyPluginAsync = async (app) => {
  // ---------- Resend ----------
  // Per-connection secret: resend's svix-signed payload references one
  // email_id, which maps to exactly one message/project/connection, so we
  // can look up the right secret before trusting anything in the body.
  app.post("/webhooks/email/resend", async (req, reply) => {
    const db = createAdminClient();
    const rawBody = rawBodyOf(req);
    const body = req.body as { type?: string; data?: { email_id?: string; bounce?: { type?: string } } };
    const emailId = body?.data?.email_id;
    if (!emailId) return reply.code(200).send({ ok: true });

    const message = await findMessageByProviderMessageId(db, emailId);
    if (!message || !message.provider_connection_id) return reply.code(200).send({ ok: true });

    const credentials = await decryptConnectionCredentials(db, message.provider_connection_id);
    const secret = credentials?.webhookSecret;
    if (!secret) {
      req.log.warn({ projectId: message.project_id }, "Resend webhook received but no webhookSecret configured on the connection");
      return reply.code(200).send({ ok: true });
    }

    const svixId = req.headers["svix-id"] as string | undefined;
    const svixTimestamp = req.headers["svix-timestamp"] as string | undefined;
    const svixSignature = req.headers["svix-signature"] as string | undefined;
    if (!svixId || !svixTimestamp || !svixSignature || !verifySvixSignature(secret, svixId, svixTimestamp, rawBody, svixSignature)) {
      return reply.code(200).send({ ok: true });
    }

    const base = { orgId: message.org_id, projectId: message.project_id, messageId: message.id, contactId: message.contact_id, channel: message.channel as "em" };
    switch (body.type) {
      case "email.delivered":
        await recordEvent(db, { ...base, eventType: "delivered", messageStatus: "delivered" });
        break;
      case "email.bounced": {
        // Permanent (hard) bounces mean the address itself is bad — mark it
        // invalid so the sequence stops retrying it forever. Transient/soft
        // bounces stay "bounced" (recorded, but not necessarily a dead address).
        const isHardBounce = body.data?.bounce?.type === "Permanent";
        await recordEvent(db, {
          ...base,
          eventType: "bounced",
          messageStatus: "bounced",
          payload: { bounceType: body.data?.bounce?.type },
          contactUpdate: { em_status: isHardBounce ? "invalid" : "bounced" },
        });
        break;
      }
      case "email.complained":
        await recordEvent(db, { ...base, eventType: "complained", contactUpdate: { em_status: "opted_out", wa_status: "opted_out" } });
        break;
      default:
        await recordEvent(db, { ...base, eventType: body.type ?? "unknown" });
    }
    return reply.code(200).send({ ok: true });
  });

  // ---------- SendGrid ----------
  // SendGrid signs the whole batch POST as one unit (ECDSA over
  // timestamp+rawBody), so unlike Resend there's no single message to look
  // up a per-connection key from before verifying. This assumes one SendGrid
  // account's verification key per deployment (SENDGRID_WEBHOOK_VERIFICATION_KEY),
  // same pattern as CREDENTIAL_VAULT_MASTER_KEY/META_APP_SECRET — revisit if
  // multiple SendGrid-connected projects need independent keys.
  app.post("/webhooks/email/sendgrid", async (req, reply) => {
    const db = createAdminClient();
    const rawBody = rawBodyOf(req);
    const verificationKey = process.env.SENDGRID_WEBHOOK_VERIFICATION_KEY;
    const signature = req.headers["x-twilio-email-event-webhook-signature"] as string | undefined;
    const timestamp = req.headers["x-twilio-email-event-webhook-timestamp"] as string | undefined;

    if (!verificationKey || !signature || !timestamp || !verifySendGridSignature(verificationKey, rawBody, signature, timestamp)) {
      return reply.code(200).send({ ok: true });
    }

    const events = Array.isArray(req.body) ? (req.body as { event?: string; sg_message_id?: string }[]) : [];
    for (const event of events) {
      const sgMessageId = event.sg_message_id?.split(".")[0];
      if (!sgMessageId) continue;
      const message = await findMessageByProviderMessageId(db, sgMessageId);
      if (!message) continue;
      const base = { orgId: message.org_id, projectId: message.project_id, messageId: message.id, contactId: message.contact_id, channel: message.channel as "em" };
      switch (event.event) {
        case "delivered":
          await recordEvent(db, { ...base, eventType: "delivered", messageStatus: "delivered" });
          break;
        case "bounce":
          // SendGrid's own classification: "bounce" is their permanent/hard
          // bounce signal (temporary delivery issues arrive as a separate
          // "blocked"/"deferred" event, not a sub-type of "bounce") — the
          // address itself is bad, so mark it invalid rather than just bounced.
          await recordEvent(db, { ...base, eventType: "bounced", messageStatus: "bounced", contactUpdate: { em_status: "invalid" } });
          break;
        case "dropped":
          await recordEvent(db, { ...base, eventType: "dropped", messageStatus: "failed", contactUpdate: { em_status: "failed" } });
          break;
        case "spamreport":
        case "unsubscribe":
        case "group_unsubscribe":
          await recordEvent(db, { ...base, eventType: "opted_out", contactUpdate: { em_status: "opted_out", wa_status: "opted_out" } });
          break;
        // open/click are already recorded by our own tracking pixel/redirect.
      }
    }
    return reply.code(200).send({ ok: true });
  });

  // ---------- Meta WhatsApp Cloud API ----------
  // One Meta App receives webhooks for every WABA number subscribed to it,
  // so the signature secret (app secret) is global, not per-connection.
  app.get("/webhooks/whatsapp/meta", async (req, reply) => {
    const q = req.query as Record<string, string>;
    const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN;
    if (q["hub.mode"] === "subscribe" && verifyToken && q["hub.verify_token"] === verifyToken) {
      return reply.code(200).send(q["hub.challenge"]);
    }
    return reply.code(403).send("verification failed");
  });

  app.post("/webhooks/whatsapp/meta", async (req, reply) => {
    const db = createAdminClient();
    const rawBody = rawBodyOf(req);
    const appSecret = process.env.META_APP_SECRET;
    const signature = req.headers["x-hub-signature-256"] as string | undefined;
    if (!appSecret || !verifyMetaSignature(appSecret, rawBody, signature)) {
      return reply.code(200).send({ ok: true });
    }

const body = req.body as {
      entry?: {
        id?: string;
        changes?: {
          field?: string;
          value?: {
            metadata?: { display_phone_number?: string };
            statuses?: any[];
            messages?: any[];
            event?: string;
            message_template_name?: string;
            message_template_language?: string;
            reason?: string;
          };
        }[];
      }[];
    };

    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        if (!value) continue;

        if (change.field === "message_template_status_update") {
          const wabaId = entry.id;
          if (!wabaId || !value.message_template_name) continue;
          const project = await resolveProjectByWabaId(db, wabaId);
          if (!project) continue;
          // Meta's PENDING/APPROVED/REJECTED normalized to this app's Title
          // Case convention (templates.meta_status defaults to "Draft").
          const status = value.event ? value.event.charAt(0) + value.event.slice(1).toLowerCase() : "Pending";
          const { data: waTemplate } = await db
            .from("wa_templates")
            .update({ status, rejection_reason: value.reason ?? null, updated_at: new Date().toISOString() })
            .eq("project_id", project.id)
            .eq("meta_name", value.message_template_name)
            .eq("language", value.message_template_language ?? "en")
            .select("template_id")
            .maybeSingle();
          const templateId = (waTemplate as { template_id: string | null } | null)?.template_id;
          if (templateId) await db.from("templates").update({ meta_status: status }).eq("id", templateId);
          continue;
        }

        const displayNumber = normPhone(value.metadata?.display_phone_number);
        if (!displayNumber) continue;
        const { data: project } = await db.from("projects").select("id, org_id").eq("wa_number", value.metadata?.display_phone_number ?? "").maybeSingle();
        // Fall back to a normalized comparison if the exact string didn't match.
        const resolvedProject =
          project ??
          (await (async () => {
            const { data: candidates } = await db.from("projects").select("id, org_id, wa_number");
            return (candidates as { id: string; org_id: string; wa_number: string | null }[] | null)?.find((p) => normPhone(p.wa_number) === displayNumber) ?? null;
          })());
        if (!resolvedProject) continue;

        for (const status of value.statuses ?? []) {
          const message = await findMessageByProviderMessageId(db, status.id);
          if (!message) continue;
          const base = { orgId: message.org_id, projectId: message.project_id, messageId: message.id, contactId: message.contact_id, channel: "wa" as const };
          if (status.status === "delivered") await recordEvent(db, { ...base, eventType: "delivered", messageStatus: "delivered" });
          else if (status.status === "read") await recordEvent(db, { ...base, eventType: "read", messageStatus: "read" });
          else if (status.status === "failed")
            await recordEvent(db, { ...base, eventType: "failed", messageStatus: "failed", payload: { errors: status.errors }, contactUpdate: { wa_status: "failed" } });
        }

        for (const inbound of value.messages ?? []) {
          const fromPhone = normPhone(inbound.from);
          if (!fromPhone) continue;
          const { data: contact } = await db
            .from("contacts")
            .select("id, org_id")
            .eq("project_id", resolvedProject.id)
            .eq("phone", fromPhone)
            .maybeSingle();
          if (!contact) continue;
          const text = inbound.text?.body ?? "";
          const c = contact as { id: string; org_id: string };
          if (isOptOutText(text)) {
            await recordEvent(db, {
              orgId: c.org_id,
              projectId: resolvedProject.id,
              messageId: null,
              contactId: c.id,
              channel: "wa",
              eventType: "opted_out",
              payload: { body: text },
              contactUpdate: { em_status: "opted_out", wa_status: "opted_out" },
            });
          } else {
            await recordEvent(db, {
              orgId: c.org_id,
              projectId: resolvedProject.id,
              messageId: null,
              contactId: c.id,
              channel: "wa",
              eventType: "replied",
              payload: { body: text },
              contactUpdate: { wa_status: "replied" },
            });
          }
        }
      }
    }
    return reply.code(200).send({ ok: true });
  });

  // ---------- Twilio ----------
  // Status callbacks (About OUR sent messages) and inbound messages share
  // this one URL in a typical setup; the project's own number shows up as
  // "From" on a status callback but "To" on an inbound message, so both are
  // checked to resolve which project owns this webhook.
  app.post("/webhooks/whatsapp/twilio", async (req, reply) => {
    const db = createAdminClient();
    const params = req.body as Record<string, string>;
    const fullUrl = `${process.env.API_PUBLIC_URL ?? ""}/webhooks/whatsapp/twilio`;
    const signature = req.headers["x-twilio-signature"] as string | undefined;

    const ourNumber = normPhone(params.From?.replace("whatsapp:", "")) || normPhone(params.To?.replace("whatsapp:", ""));
    const { data: candidates } = await db.from("projects").select("id, org_id, wa_number");
    const project = (candidates as { id: string; org_id: string; wa_number: string | null }[] | null)?.find((p) => normPhone(p.wa_number) === ourNumber);
    if (!project) return reply.code(200).send({ ok: true });

    const { data: conn } = await db
      .from("provider_connections")
      .select("id")
      .eq("project_id", project.id)
      .eq("kind", "whatsapp")
      .eq("provider", "twilio")
      .eq("status", "connected")
      .maybeSingle();
    if (!conn) return reply.code(200).send({ ok: true });

    const credentials = await decryptConnectionCredentials(db, (conn as { id: string }).id);
    const authToken = credentials?.authToken;
    if (!authToken || !verifyTwilioSignature(authToken, fullUrl, params, signature)) {
      return reply.code(200).send({ ok: true });
    }

    if (params.MessageStatus && params.MessageSid) {
      const message = await findMessageByProviderMessageId(db, params.MessageSid);
      if (message) {
        const base = { orgId: message.org_id, projectId: message.project_id, messageId: message.id, contactId: message.contact_id, channel: "wa" as const };
        const status = params.MessageStatus;
        if (status === "delivered") await recordEvent(db, { ...base, eventType: "delivered", messageStatus: "delivered" });
        else if (status === "read") await recordEvent(db, { ...base, eventType: "read", messageStatus: "read" });
        else if (status === "failed" || status === "undelivered")
          await recordEvent(db, { ...base, eventType: "failed", messageStatus: "failed", payload: { errorCode: params.ErrorCode }, contactUpdate: { wa_status: "failed" } });
      }
    } else if (params.Body !== undefined && params.From) {
      const fromPhone = normPhone(params.From.replace("whatsapp:", ""));
      const { data: contact } = await db.from("contacts").select("id, org_id").eq("project_id", project.id).eq("phone", fromPhone).maybeSingle();
      if (contact) {
        const c = contact as { id: string; org_id: string };
        if (isOptOutText(params.Body)) {
          await recordEvent(db, {
            orgId: c.org_id,
            projectId: project.id,
            messageId: null,
            contactId: c.id,
            channel: "wa",
            eventType: "opted_out",
            payload: { body: params.Body },
            contactUpdate: { em_status: "opted_out", wa_status: "opted_out" },
          });
        } else {
          await recordEvent(db, {
            orgId: c.org_id,
            projectId: project.id,
            messageId: null,
            contactId: c.id,
            channel: "wa",
            eventType: "replied",
            payload: { body: params.Body },
            contactUpdate: { wa_status: "replied" },
          });
        }
      }
    }
    return reply.type("text/xml").code(200).send("<Response></Response>");
  });

  // ---------- Stubs: acknowledged so these providers don't retry-storm us,
  // built out when first actually used for a live campaign. ----------
  for (const provider of ["brevo", "ses", "gmail", "outlook"]) {
    app.post(`/webhooks/email/${provider}`, async (_req, reply) => reply.code(200).send({ ok: true }));
  }
  for (const provider of ["360dialog", "gupshup", "interakt", "aisensy"]) {
    app.post(`/webhooks/whatsapp/${provider}`, async (_req, reply) => reply.code(200).send({ ok: true }));
  }
};
