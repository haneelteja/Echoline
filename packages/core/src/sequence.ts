import { CHANNEL_KEYS, type ChannelKey, isTerminal, type ContactChannelStatus } from "./status";
import type { Contact, DueStep, SequenceSettings } from "./types";
import { normPhone, validEmail } from "./validate";

export function statusOf(c: Contact, ch: ChannelKey): ContactChannelStatus {
  return ch === "em" ? c.em_status : c.wa_status;
}

function stageOf(c: Contact, ch: ChannelKey): number {
  return ch === "em" ? c.em_stage : c.wa_stage;
}

function lastOf(c: Contact, ch: ChannelKey): string | null | undefined {
  return ch === "em" ? c.em_last : c.wa_last;
}

/**
 * Ported from the prototype's nextDue(). Returns the next due step for a contact
 * on a channel, or null if the sequence is disabled, the contact is in a terminal
 * state, stop-on-reply has tripped, or all steps have been sent.
 */
export function nextDue(c: Contact, ch: ChannelKey, seq: SequenceSettings): DueStep | null {
  const cfg = seq[ch];
  if (!cfg?.enabled) return null;

  const status = statusOf(c, ch);
  if (isTerminal(status)) return null;

  if (
    seq.stopOnReply &&
    (c.em_status === "replied" ||
      c.wa_status === "replied" ||
      c.em_status === "opted_out" ||
      c.wa_status === "opted_out")
  ) {
    return null;
  }

  const stage = stageOf(c, ch) || 0;
  if (stage >= cfg.steps.length) return null;

  const valid = ch === "em" ? validEmail(c.email) : !!normPhone(c.phone);

  if (stage === 0) {
    return { contactId: c.id, channel: ch, step: 0, at: new Date(0).toISOString(), valid };
  }

  const last = lastOf(c, ch);
  const delayDays = cfg.steps[stage]?.delayDays ?? 0;
  const at = new Date(new Date(last ?? 0).getTime() + delayDays * 864e5).toISOString();
  return { contactId: c.id, channel: ch, step: stage, at, valid };
}

export function dueList(contacts: Contact[], seq: SequenceSettings, now = Date.now()): DueStep[] {
  const out: DueStep[] = [];
  for (const c of contacts) {
    for (const ch of CHANNEL_KEYS) {
      const d = nextDue(c, ch, seq);
      if (d && new Date(d.at).getTime() <= now) out.push(d);
    }
  }
  return out;
}

export function upcomingList(contacts: Contact[], seq: SequenceSettings, now = Date.now()): DueStep[] {
  const out: DueStep[] = [];
  for (const c of contacts) {
    for (const ch of CHANNEL_KEYS) {
      const d = nextDue(c, ch, seq);
      if (d && new Date(d.at).getTime() > now) out.push(d);
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/**
 * Applies the send window (project-local time) and business-day rule to a due step.
 * Does NOT apply daily caps or rate limits — those are enforced by the scheduler
 * worker (Phase 3) since they depend on how many sends have already happened today.
 */
export function isWithinSendWindow(
  at: Date,
  window: { start: string; end: string },
  timezone: string
): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  }).formatToParts(at);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const isBusinessDay = !["Sat", "Sun"].includes(weekday);

  const mins = hour * 60 + minute;
  const [sh, sm] = window.start.split(":").map(Number);
  const [eh, em] = window.end.split(":").map(Number);
  const startMins = sh * 60 + sm;
  const endMins = eh * 60 + em;

  return isBusinessDay && mins >= startMins && mins <= endMins;
}
