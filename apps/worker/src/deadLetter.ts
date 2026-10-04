import type { createAdminClient } from "@echoline/db";

const MAX_SCHEDULER_TICK_FAILURES = 3;

/**
 * A single send job already retries 5x (exponential backoff) within one
 * BullMQ job — but nothing stopped a *new* job from being enqueued on every
 * 5-minute scheduler tick after that, forever, for a contact whose failure
 * is permanent (e.g. bad credentials nobody's fixed). That's an effectively
 * infinite retry loop: a Sentry alert every 5 minutes, indefinitely, with
 * no mechanism to say "stop, a human needs to look at this."
 *
 * This is this project's dead-letter queue: not a separate BullMQ queue
 * (which would just duplicate what message_events already records
 * durably), but a failure-count threshold. After MAX_SCHEDULER_TICK_FAILURES
 * separate scheduler-tick-level exhaustions for the same contact+channel+step,
 * the contact's status moves to the existing terminal "failed" status —
 * nextDue()/dueList() already treat terminal statuses as "stop offering
 * this," so it simply stops being retried, with a distinct "dead_letter"
 * event recorded for visibility in the Activity log.
 */
export async function deadLetterIfExhausted(
  db: ReturnType<typeof createAdminClient>,
  opts: { orgId: string; projectId: string; contactId: string; step: number; channel: "em" | "wa"; messageId: string; error: string }
): Promise<void> {
  const { count } = await db
    .from("message_events")
    .select("id", { count: "exact", head: true })
    .eq("contact_id", opts.contactId)
    .eq("channel", opts.channel)
    .eq("event_type", "failed")
    .contains("payload", { step: opts.step });
  if ((count ?? 0) < MAX_SCHEDULER_TICK_FAILURES) return;

  const statusField = opts.channel === "em" ? "em_status" : "wa_status";
  await db.from("contacts").update({ [statusField]: "failed" }).eq("id", opts.contactId);
  await db.from("message_events").insert({
    org_id: opts.orgId,
    project_id: opts.projectId,
    message_id: opts.messageId,
    contact_id: opts.contactId,
    channel: opts.channel,
    event_type: "dead_letter",
    payload: { step: opts.step, error: opts.error, schedulerTickFailures: count },
  });
}
