import { Worker, type Job } from "bullmq";
import pino from "pino";
import { createAdminClient, decryptCredentials, loadMasterKey, rowToEnvelope, type ContactRow, type ProjectRow, type TemplateRow } from "@echoline/db";
import { getWhatsAppTemplateSender, getWhatsAppTextSender, TEXT_ONLY_WHATSAPP_PROVIDERS, type WhatsAppProviderId } from "@echoline/providers";
import { STAGE_STATUS_KEYS, normPhone, fill } from "@echoline/core";
import { reportIfExhausted } from "../sentry.js";
import { deadLetterIfExhausted } from "../deadLetter.js";
import { getRedisConnection } from "../redis.js";
import { SEND_WHATSAPP_QUEUE, type SendJobData } from "../queues.js";
import { isTestSendMode, testSendWhatsApp } from "../testSendMode.js";

const log = pino({ name: "send-whatsapp-worker", level: process.env.LOG_LEVEL ?? "info" });

function masterKey() {
  return loadMasterKey(process.env.CREDENTIAL_VAULT_MASTER_KEY);
}

async function fetchHeaderMedia(
  db: ReturnType<typeof createAdminClient>,
  assetId: string | null | undefined
): Promise<{ url: string; kind: "image" | "document"; name: string } | null> {
  if (!assetId) return null;
  const { data } = await db.from("kb_assets").select("url, kind, name").eq("id", assetId).maybeSingle();
  return (data as { url: string; kind: "image" | "document"; name: string } | null) ?? null;
}

export function startWhatsAppWorker(): Worker<SendJobData> {
  const worker = new Worker<SendJobData>(SEND_WHATSAPP_QUEUE, processWhatsAppJob, {
    connection: getRedisConnection(),
    concurrency: 5,
  });
  worker.on("failed", (job, err) => {
    log.error({ jobId: job?.id, err }, "whatsapp job failed");
    reportIfExhausted(job, err);
  });
  return worker;
}

async function processWhatsAppJob(job: Job<SendJobData>): Promise<void> {
  const db = createAdminClient();
  const { orgId, projectId, contactId, step } = job.data;

  // Idempotency: claim_message_send is the real guard (see its migration for
  // why a plain insert-and-treat-conflict-as-duplicate breaks retries). It
  // returns SQL NULL if another attempt already holds or completed this slot —
  // but PostgREST serializes a NULL composite as an object with every field
  // null (row_to_json(NULL::messages) is a Postgres quirk), not JSON null, so
  // we must check claimed.id rather than claimed itself.
  const { data: claimed, error: claimErr } = await db.rpc("claim_message_send", {
    p_org_id: orgId,
    p_project_id: projectId,
    p_contact_id: contactId,
    p_channel: "wa",
    p_step: step,
  });
  if (claimErr) throw claimErr;
  if (!claimed?.id) {
    log.info({ projectId, contactId, step }, "whatsapp step already in flight or sent, skipping");
    return;
  }
  const messageId = (claimed as { id: string }).id;

  async function fail(reason: string, eventType: "blocked" | "failed") {
    await db.from("messages").update({ status: "failed" }).eq("id", messageId);
    await db.from("message_events").insert({
      org_id: orgId,
      project_id: projectId,
      message_id: messageId,
      contact_id: contactId,
      channel: "wa",
      event_type: eventType,
      payload: { step, reason },
    });
  }

  try {
    const [{ data: contact }, { data: project }, { data: template }, { data: conn }, { data: seq }] = await Promise.all([
      db.from("contacts").select("*").eq("id", contactId).single(),
      db.from("projects").select("*").eq("id", projectId).single(),
      db.from("templates").select("*").eq("project_id", projectId).eq("channel", "whatsapp").eq("step", step).maybeSingle(),
      db.from("provider_connections").select("*").eq("project_id", projectId).eq("kind", "whatsapp").eq("status", "connected").maybeSingle(),
      db.from("sequence_settings").select("wa").eq("project_id", projectId).single(),
    ]);

    const c = contact as ContactRow | null;
    const phone = normPhone(c?.phone ?? null);
    if (!c || !phone) throw new Error("Contact has no valid WhatsApp number");
    if (!conn) throw new Error("No connected WhatsApp provider for this project");

    const t = template as TemplateRow | null;
    if (!t) {
      await fail("No WhatsApp template configured for this step", "blocked");
      return;
    }

    const providerId = (conn as any).provider as WhatsAppProviderId;
    const credentials = JSON.parse(decryptCredentials(rowToEnvelope(conn as any), masterKey()));
    const pr = project as ProjectRow;

    // Testing-phase safety valve: redirect to a fixed test number instead of
    // the real lead. Free-text sends get a prefix naming the real lead (so a
    // shared test number stays legible); an Approved Meta template's body is
    // fixed by Meta and can't be altered, so the real lead is only visible
    // via message_events.payload for those.
    const testMode = isTestSendMode();
    const toPhone = testMode ? testSendWhatsApp() : phone;
    const fillCtx = {
      project: { name: pr.name, brand: pr.brand, senderName: pr.sender_name, website: pr.website, waNumber: pr.wa_number, accent: pr.accent },
      contact: { name: c.name, contactPerson: c.contact_person, area: c.area, category: c.category },
      template: { categoryLines: t.category_lines ?? {} },
    };

    let result: { providerMessageId: string };
    if (TEXT_ONLY_WHATSAPP_PROVIDERS.has(providerId)) {
      // Unofficial/personal-number providers (e.g. 360Messenger) have no
      // template-approval system at all — Meta's "cold sends need an
      // Approved template" rule is a policy on the official Business API,
      // not something these providers enforce. Send the template body as
      // free-form text instead.
      const sender = getWhatsAppTextSender(providerId);
      if (!sender) throw new Error(`No text sender implemented for provider ${providerId}`);
      const text = testMode ? `[TEST → ${c.name} ${phone}, step ${step}]\n${fill(t.body, fillCtx)}` : fill(t.body, fillCtx);
      result = await sender(credentials, { to: toPhone, text });
    } else {
      // Cold, business-initiated WhatsApp sends must use an approved
      // template — a hard Meta policy requirement, not just a best practice.
      if (t.meta_status !== "Approved") {
        await fail(`Template "${t.name ?? t.meta_name ?? "untitled"}" is not Approved (status: ${t.meta_status ?? "Draft"})`, "blocked");
        return;
      }
      if (!t.meta_name) {
        await fail("Template has no registered Meta template name", "blocked");
        return;
      }
      const sender = getWhatsAppTemplateSender(providerId);
      if (!sender) throw new Error(`No sender implemented for provider ${providerId}`);

      // variable_map (set by waTemplates.ts at submission time) is the
      // ordered list of our own {{placeholder}} keys matching Meta's
      // approved {{1}}, {{2}}... positions. A template submitted with no
      // placeholders has an empty map, correctly meaning "no components".
      const { data: waTemplate } = await db.from("wa_templates").select("variable_map").eq("template_id", t.id).maybeSingle();
      const variableMap = ((waTemplate as { variable_map?: string[] } | null)?.variable_map ?? []) as string[];
      const components =
        variableMap.length > 0
          ? [{ type: "body" as const, parameters: variableMap.map((key) => ({ type: "text" as const, text: fill(`{{${key}}}`, fillCtx) })) }]
          : undefined;
      const header = await fetchHeaderMedia(db, t.header_asset_id);
      result = await sender(credentials, {
        to: toPhone,
        templateName: t.meta_name,
        language: "en",
        components,
        mediaUrls: header ? [header.url] : undefined,
        mediaKind: header?.kind,
        mediaFilename: header?.kind === "document" ? header.name : undefined,
      });
    }

    const totalSteps = ((seq as any)?.wa?.steps?.length as number) ?? step + 1;
    const newStage = step + 1;
    const newStatus = newStage >= totalSteps ? "completed" : STAGE_STATUS_KEYS[newStage];

    await Promise.all([
      db
        .from("messages")
        .update({
          status: "sent",
          provider_message_id: result.providerMessageId,
          provider_connection_id: (conn as any).id,
          sent_at: new Date().toISOString(),
        })
        .eq("id", messageId),
      db
        .from("contacts")
        .update({ wa_stage: newStage, wa_status: newStatus, wa_last: new Date().toISOString(), wa_track: "sent" })
        .eq("id", contactId),
      db.from("message_events").insert({
        org_id: orgId,
        project_id: projectId,
        message_id: messageId,
        contact_id: contactId,
        channel: "wa",
        event_type: "sent",
        payload: { step, providerMessageId: result.providerMessageId, test: testMode },
      }),
    ]);
    log.info({ messageId, contactId, step }, "whatsapp sent");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    await db.from("messages").update({ status: "failed" }).eq("id", messageId);
    if (isLastAttempt) {
      await db.from("message_events").insert({
        org_id: orgId,
        project_id: projectId,
        message_id: messageId,
        contact_id: contactId,
        channel: "wa",
        event_type: "failed",
        payload: { step, error: message, attempts: job.attemptsMade + 1 },
      });
      await deadLetterIfExhausted(db, { orgId, projectId, contactId, step, channel: "wa", messageId, error: message });
    }
    throw err;
  }
}
