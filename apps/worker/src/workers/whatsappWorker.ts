import { Worker, type Job } from "bullmq";
import pino from "pino";
import { createAdminClient, decryptCredentials, loadMasterKey, rowToEnvelope, type ContactRow, type TemplateRow } from "@echoline/db";
import { getWhatsAppTemplateSender } from "@echoline/providers";
import { STAGE_STATUS_KEYS, normPhone } from "@echoline/core";
import { getRedisConnection } from "../redis.js";
import { SEND_WHATSAPP_QUEUE, type SendJobData } from "../queues.js";

const log = pino({ name: "send-whatsapp-worker", level: process.env.LOG_LEVEL ?? "info" });

function masterKey() {
  return loadMasterKey(process.env.CREDENTIAL_VAULT_MASTER_KEY);
}

export function startWhatsAppWorker(): Worker<SendJobData> {
  const worker = new Worker<SendJobData>(SEND_WHATSAPP_QUEUE, processWhatsAppJob, {
    connection: getRedisConnection(),
    concurrency: 5,
  });
  worker.on("failed", (job, err) => log.error({ jobId: job?.id, err }, "whatsapp job failed"));
  return worker;
}

async function processWhatsAppJob(job: Job<SendJobData>): Promise<void> {
  const db = createAdminClient();
  const { orgId, projectId, contactId, step } = job.data;

  const { data: claimed, error: claimErr } = await db
    .from("messages")
    .insert({ org_id: orgId, project_id: projectId, contact_id: contactId, channel: "wa", step, status: "queued" })
    .select()
    .single();
  if (claimErr) {
    if (claimErr.code === "23505") {
      log.info({ projectId, contactId, step }, "whatsapp step already claimed, skipping");
      return;
    }
    throw claimErr;
  }
  const messageId = claimed.id;

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
    const [{ data: contact }, { data: template }, { data: conn }, { data: seq }] = await Promise.all([
      db.from("contacts").select("*").eq("id", contactId).single(),
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
    // Cold, business-initiated WhatsApp sends must use an approved template —
    // this is a hard Meta policy requirement, not just a best practice.
    if (t.meta_status !== "Approved") {
      await fail(`Template "${t.name ?? t.meta_name ?? "untitled"}" is not Approved (status: ${t.meta_status ?? "Draft"})`, "blocked");
      return;
    }
    if (!t.meta_name) {
      await fail("Template has no registered Meta template name", "blocked");
      return;
    }

    const sender = getWhatsAppTemplateSender((conn as any).provider);
    if (!sender) throw new Error(`No sender implemented for provider ${(conn as any).provider}`);

    const credentials = JSON.parse(decryptCredentials(rowToEnvelope(conn as any), masterKey()));
    // Phase 6 will map {{placeholders}} to Meta's registered numbered
    // variables; for now we send the approved template as registered
    // (no dynamic components), which is valid for templates without variables.
    const result = await sender(credentials, { to: phone, templateName: t.meta_name, language: "en" });

    const totalSteps = ((seq as any)?.wa?.steps?.length as number) ?? step + 1;
    const newStage = step + 1;
    const newStatus = newStage >= totalSteps ? "completed" : STAGE_STATUS_KEYS[newStage];

    await Promise.all([
      db
        .from("messages")
        .update({ status: "sent", provider_message_id: result.providerMessageId, sent_at: new Date().toISOString() })
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
        payload: { step, providerMessageId: result.providerMessageId },
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
    }
    throw err;
  }
}
