import { createAdminClient, type ProjectRow, type SequenceSettingsRow, type ContactRow } from "@echoline/db";
import { dueList, isWithinSendWindow } from "@echoline/core";
import type { Logger } from "pino";
import { getSendEmailQueue, getSendWhatsAppQueue } from "./queues.js";
import { toCoreContact, toCoreSequence } from "./adapt.js";

const JITTER_MAX_MS = 2 * 60 * 1000; // up to 2 minutes, spreads sends across a tick

function jitter(): number {
  return Math.floor(Math.random() * JITTER_MAX_MS);
}

/** Runs once per scheduler tick: computes due steps for every project and
 * enqueues sends. Idempotency is enforced downstream by the send workers
 * claiming a unique (project_id, contact_id, channel, step) row in `messages`
 * before actually sending — re-enqueueing the same due step across ticks
 * (e.g. because the first job hasn't completed yet) is safe by design. */
export async function runSchedulerTick(log: Logger): Promise<void> {
  const db = createAdminClient();
  const { data: projects, error } = await db.from("projects").select("*");
  if (error) {
    log.error({ error }, "scheduler: failed to list projects");
    return;
  }
  for (const project of (projects ?? []) as ProjectRow[]) {
    try {
      await processProject(db, project, log, { force: false });
    } catch (err) {
      log.error({ err, projectId: project.id }, "scheduler: project processing failed");
    }
  }
}

/** Powers the manual "Run due steps now" button — same logic as a scheduler
 * tick but scoped to one project, and `force: true` skips the send-window
 * check since an explicit operator action means "run now", not "whenever the
 * window next opens". Daily cap and template-approval gating still apply. */
export async function runSchedulerForProject(projectId: string, log: Logger): Promise<{ enqueued: number }> {
  const db = createAdminClient();
  const { data: project, error } = await db.from("projects").select("*").eq("id", projectId).single();
  if (error || !project) {
    log.error({ error, projectId }, "scheduler: project not found");
    return { enqueued: 0 };
  }
  return processProject(db, project as ProjectRow, log, { force: true });
}

async function processProject(
  db: ReturnType<typeof createAdminClient>,
  project: ProjectRow,
  log: Logger,
  opts: { force: boolean }
): Promise<{ enqueued: number }> {
  const { data: seqRow } = await db.from("sequence_settings").select("*").eq("project_id", project.id).maybeSingle();
  if (!seqRow) return { enqueued: 0 };
  const seq = toCoreSequence(seqRow as SequenceSettingsRow);
  if (!seq.em.enabled && !seq.wa.enabled) return { enqueued: 0 };

  if (!opts.force && !isWithinSendWindow(new Date(), seq.window, project.timezone)) return { enqueued: 0 };

  const { data: contactRows } = await db.from("contacts").select("*").eq("project_id", project.id);
  const contacts = ((contactRows ?? []) as ContactRow[]).map(toCoreContact);
  const due = dueList(contacts, seq);
  if (!due.length) return { enqueued: 0 };

  // Daily cap, counted from messages actually queued-or-sent today (UTC day —
  // precise per-timezone cap accounting is a refinement for later; this is
  // conservative, not permissive, since it only undercounts across a DST-ish
  // boundary mismatch, never overcounts).
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const counts: Record<"em" | "wa", number> = { em: 0, wa: 0 };
  for (const ch of ["em", "wa"] as const) {
    const { count } = await db
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("project_id", project.id)
      .eq("channel", ch)
      .gte("queued_at", todayStart.toISOString());
    counts[ch] = count ?? 0;
  }

  const emailQueue = getSendEmailQueue();
  const whatsappQueue = getSendWhatsAppQueue();

  let enqueued = 0;
  for (const d of due) {
    if (!d.valid) {
      await markInvalid(db, project.org_id, project.id, d.contactId, d.channel);
      continue;
    }
    if (counts[d.channel] >= seq.dailyCap) continue;
    counts[d.channel]++;

    const queue = d.channel === "em" ? emailQueue : whatsappQueue;
    // Idempotency is enforced entirely by claim_message_send in the database
    // (see its migration), NOT by this job ID — a deterministic ID would mean
    // that once a job reaches a terminal state (failed or completed), BullMQ
    // refuses to run a same-ID job again, permanently blocking any retry on
    // the next tick or a manual "Run due steps now". The timestamp suffix
    // keeps each enqueue a genuinely new, processable job; the prefix stays
    // human-readable for log correlation. BullMQ also rejects ":" in job IDs.
    const jobId = `${project.id}_${d.contactId}_${d.channel}_${d.step}_${Date.now()}`;
    await queue.add(
      "send",
      { orgId: project.org_id, projectId: project.id, contactId: d.contactId, step: d.step },
      { jobId, delay: opts.force ? 0 : jitter(), attempts: 5, backoff: { type: "exponential", delay: 30_000 }, removeOnComplete: 1000, removeOnFail: 1000 }
    );
    enqueued++;
    log.info({ jobId }, "scheduler: enqueued send");
  }
  return { enqueued };
}

async function markInvalid(
  db: ReturnType<typeof createAdminClient>,
  orgId: string,
  projectId: string,
  contactId: string,
  channel: "em" | "wa"
): Promise<void> {
  const statusField = `${channel}_status`;
  await db.from("contacts").update({ [statusField]: "invalid" }).eq("id", contactId);
  await db.from("message_events").insert({
    org_id: orgId,
    project_id: projectId,
    contact_id: contactId,
    channel,
    event_type: "invalid",
    payload: { reason: channel === "em" ? "invalid email" : "invalid phone" },
  });
}
