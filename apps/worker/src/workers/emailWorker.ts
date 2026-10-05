import { Worker, type Job } from "bullmq";
import pino from "pino";
import {
  createAdminClient,
  decryptCredentials,
  encryptCredentials,
  loadMasterKey,
  rowToEnvelope,
  envelopeToRow,
  type ProjectRow,
  type ContactRow,
  type TemplateRow,
} from "@echoline/db";
import { getEmailSender, makeRewriteLink, buildOpenPixelUrl, buildUnsubscribeUrl, refreshGoogleToken, refreshMicrosoftToken } from "@echoline/providers";
import { fill, fillPlainText, emailHTML, buildUnsubscribeHeaders, STAGE_STATUS_KEYS, validEmail } from "@echoline/core";
import { reportIfExhausted } from "../sentry.js";
import { deadLetterIfExhausted } from "../deadLetter.js";
import { getRedisConnection } from "../redis.js";
import { SEND_EMAIL_QUEUE, type SendJobData } from "../queues.js";
import { isTestSendMode, testSendEmail } from "../testSendMode.js";

const log = pino({ name: "send-email-worker", level: process.env.LOG_LEVEL ?? "info" });

function masterKey() {
  return loadMasterKey(process.env.CREDENTIAL_VAULT_MASTER_KEY);
}

function trackingConfig() {
  return { secret: process.env.TRACKING_SIGNING_SECRET ?? "", baseUrl: process.env.API_PUBLIC_URL ?? "" };
}

/**
 * Gmail/Outlook access tokens expire in ~1 hour; refreshGoogleToken/
 * refreshMicrosoftToken existed but were never actually called anywhere,
 * so any OAuth connection would silently start failing once its first
 * access token expired. Refreshes unconditionally before every OAuth send
 * (simpler and safer than tracking expiry ourselves — refreshing early
 * doesn't invalidate the still-valid token) and persists the result,
 * since Microsoft rotates the refresh token on every use.
 */
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

export function startEmailWorker(): Worker<SendJobData> {
  const worker = new Worker<SendJobData>(SEND_EMAIL_QUEUE, processEmailJob, {
    connection: getRedisConnection(),
    concurrency: 5,
  });
  worker.on("failed", (job, err) => {
    log.error({ jobId: job?.id, err }, "email job failed");
    reportIfExhausted(job, err);
  });
  return worker;
}

async function processEmailJob(job: Job<SendJobData>): Promise<void> {
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
    p_channel: "em",
    p_step: step,
  });
  if (claimErr) throw claimErr;
  if (!claimed?.id) {
    log.info({ projectId, contactId, step }, "email step already in flight or sent, skipping");
    return;
  }
  const messageId = (claimed as { id: string }).id;

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
    // fill()'s FillContext expects camelCase (contactPerson), not the raw
    // ContactRow's snake_case contact_person — passing `c` directly silently
    // always fell back to "team" for {{contact_name}} regardless of whether
    // a contact person was actually on file. whatsappWorker.ts already maps
    // this correctly; email's send path did not.
    const contactCtx = { name: c.name, contactPerson: c.contact_person, area: c.area, category: c.category };
    const ctx = { project: projectBrand, contact: contactCtx, template: t };

    const tc = trackingConfig();
    const unsubscribeUrl = buildUnsubscribeUrl(tc, messageId);
    const html = emailHTML(
      t,
      ctx,
      { logoUrl: null, galleryUrls: [] },
      { unsubscribeUrl, trackingPixelUrl: buildOpenPixelUrl(tc, messageId), rewriteLink: makeRewriteLink(tc, messageId) }
    );
    const text = fillPlainText(t.body, ctx, { unsubscribeUrl });
    let subject = fill(tRow.subject, ctx);
    const headers = buildUnsubscribeHeaders(unsubscribeUrl);

    // Testing-phase safety valve: redirect to a fixed test inbox instead of
    // the real lead, with the subject tagged so a shared test inbox stays
    // legible across many different leads/steps.
    let toEmail = c.email!;
    if (isTestSendMode()) {
      subject = `[TEST → ${c.name} <${c.email}>, step ${step}] ${subject}`;
      toEmail = testSendEmail();
    }

    const credentials = JSON.parse(decryptCredentials(rowToEnvelope(conn as any), masterKey()));
    await ensureFreshOAuthToken(db, conn as any, credentials);
    const emailSettings = ((channelSettings as any)?.email ?? {}) as Record<string, string>;
    // OAuth connections (Gmail/Outlook) send as the authenticated account
    // itself; API-key providers need an explicit sender address — either set
    // when connecting (credentials.fromEmail) or, as a last resort, the
    // connection's own account_label.
    const fromEmail = emailSettings.fromEmail || credentials.fromEmail || (conn as any).account_label;
    if (!fromEmail) throw new Error("No from-email configured for this project's email connection");

    const result = await sender(credentials, { from: fromEmail, to: toEmail, subject, html, text, headers });

    const totalSteps = ((seq as any)?.em?.steps?.length as number) ?? step + 1;
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
        .update({ em_stage: newStage, em_status: newStatus, em_last: new Date().toISOString(), em_track: "sent" })
        .eq("id", contactId),
      db.from("message_events").insert({
        org_id: orgId,
        project_id: projectId,
        message_id: messageId,
        contact_id: contactId,
        channel: "em",
        event_type: "sent",
        payload: { step, providerMessageId: result.providerMessageId, test: isTestSendMode() },
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
      await deadLetterIfExhausted(db, { orgId, projectId, contactId, step, channel: "em", messageId, error: message });
    }
    throw err; // let BullMQ record the failure / retry
  }
}
