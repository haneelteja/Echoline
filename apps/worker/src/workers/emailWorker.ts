import { Worker, type Job } from "bullmq";
import pino from "pino";
import {
  createAdminClient,
  decryptCredentials,
  loadMasterKey,
  rowToEnvelope,
  type ProjectRow,
  type ContactRow,
  type TemplateRow,
} from "@echoline/db";
import { getEmailSender, makeRewriteLink, buildOpenPixelUrl, buildUnsubscribeUrl } from "@echoline/providers";
import { fill, fillPlainText, emailHTML, buildUnsubscribeHeaders, STAGE_STATUS_KEYS, validEmail } from "@echoline/core";
import { getRedisConnection } from "../redis.js";
import { SEND_EMAIL_QUEUE, type SendJobData } from "../queues.js";

const log = pino({ name: "send-email-worker", level: process.env.LOG_LEVEL ?? "info" });

function masterKey() {
  return loadMasterKey(process.env.CREDENTIAL_VAULT_MASTER_KEY);
}

function trackingConfig() {
  return { secret: process.env.TRACKING_SIGNING_SECRET ?? "", baseUrl: process.env.API_PUBLIC_URL ?? "" };
}

export function startEmailWorker(): Worker<SendJobData> {
  const worker = new Worker<SendJobData>(SEND_EMAIL_QUEUE, processEmailJob, {
    connection: getRedisConnection(),
    concurrency: 5,
  });
  worker.on("failed", (job, err) => log.error({ jobId: job?.id, err }, "email job failed"));
  return worker;
}

async function processEmailJob(job: Job<SendJobData>): Promise<void> {
  const db = createAdminClient();
  const { orgId, projectId, contactId, step } = job.data;

  // Idempotency: the unique constraint on (project_id, contact_id, channel, step)
  // is the real guard — if this exact step was already claimed (by an earlier
  // scheduler tick's job, even after a worker restart), this insert conflicts
  // and we no-op instead of sending twice.
  const { data: claimed, error: claimErr } = await db
    .from("messages")
    .insert({ org_id: orgId, project_id: projectId, contact_id: contactId, channel: "em", step, status: "queued" })
    .select()
    .single();
  if (claimErr) {
    if (claimErr.code === "23505") {
      log.info({ projectId, contactId, step }, "email step already claimed, skipping");
      return;
    }
    throw claimErr;
  }
  const messageId = claimed.id;

  try {
    const [{ data: contact }, { data: project }, { data: template }, { data: conn }, { data: seq }, { data: channelSettings }] =
      await Promise.all([
        db.from("contacts").select("*").eq("id", contactId).single(),
        db.from("projects").select("*").eq("id", projectId).single(),
        db.from("templates").select("*").eq("project_id", projectId).eq("channel", "email").eq("step", step).maybeSingle(),
        db.from("provider_connections").select("*").eq("project_id", projectId).eq("kind", "email").eq("status", "connected").maybeSingle(),
        db.from("sequence_settings").select("em").eq("project_id", projectId).single(),
        db.from("channel_settings").select("email").eq("project_id", projectId).maybeSingle(),
      ]);

    const c = contact as ContactRow | null;
    if (!c || !validEmail(c.email)) throw new Error("Contact has no valid email");
    if (!template) throw new Error(`No email template for step ${step}`);
    if (!conn) throw new Error("No connected email provider for this project");

    const sender = getEmailSender((conn as any).provider);
    if (!sender) throw new Error(`No sender implemented for provider ${(conn as any).provider}`);

    const p = project as ProjectRow;
    const tRow = template as TemplateRow;
    const t = { body: tRow.body ?? "", categoryLines: tRow.category_lines ?? {} };
    const projectBrand = {
      name: p.name,
      brand: p.brand,
      senderName: p.sender_name,
      website: p.website,
      waNumber: p.wa_number,
      accent: p.accent,
    };
    const ctx = { project: projectBrand, contact: c, template: t };

    const tc = trackingConfig();
    const unsubscribeUrl = buildUnsubscribeUrl(tc, messageId);
    const html = emailHTML(
      t,
      ctx,
      { logoUrl: null, galleryUrls: [] },
      { unsubscribeUrl, trackingPixelUrl: buildOpenPixelUrl(tc, messageId), rewriteLink: makeRewriteLink(tc, messageId) }
    );
    const text = fillPlainText(t.body, ctx, { unsubscribeUrl });
    const subject = fill(tRow.subject, ctx);
    const headers = buildUnsubscribeHeaders(unsubscribeUrl);

    const credentials = JSON.parse(decryptCredentials(rowToEnvelope(conn as any), masterKey()));
    const emailSettings = ((channelSettings as any)?.email ?? {}) as Record<string, string>;
    // OAuth connections (Gmail/Outlook) send as the authenticated account
    // itself; API-key providers need an explicit sender address — either set
    // when connecting (credentials.fromEmail) or, as a last resort, the
    // connection's own account_label.
    const fromEmail = emailSettings.fromEmail || credentials.fromEmail || (conn as any).account_label;
    if (!fromEmail) throw new Error("No from-email configured for this project's email connection");

    const result = await sender(credentials, { from: fromEmail, to: c.email!, subject, html, text, headers });

    const totalSteps = ((seq as any)?.em?.steps?.length as number) ?? step + 1;
    const newStage = step + 1;
    const newStatus = newStage >= totalSteps ? "completed" : STAGE_STATUS_KEYS[newStage];

    await Promise.all([
      db
        .from("messages")
        .update({ status: "sent", provider_message_id: result.providerMessageId, sent_at: new Date().toISOString() })
        .eq("id", messageId),
      db
        .from("contacts")
        .update({ em_stage: newStage, em_status: newStatus, em_last: new Date().toISOString(), em_track: "sent" })
        .eq("id", contactId),
      db.from("message_events").insert({
        org_id: orgId,
        project_id: projectId,
        message_id: messageId,
        contact_id: contactId,
        channel: "em",
        event_type: "sent",
        payload: { step, providerMessageId: result.providerMessageId },
      }),
    ]);
    log.info({ messageId, contactId, step }, "email sent");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    await db
      .from("messages")
      .update({ status: "failed" })
      .eq("id", messageId);
    if (isLastAttempt) {
      await db.from("message_events").insert({
        org_id: orgId,
        project_id: projectId,
        message_id: messageId,
        contact_id: contactId,
        channel: "em",
        event_type: "failed",
        payload: { step, error: message, attempts: job.attemptsMade + 1 },
      });
    }
    throw err; // let BullMQ record the failure / retry
  }
}
