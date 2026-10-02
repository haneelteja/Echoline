import { describe, expect, it } from "vitest";
import { dueList, nextDue } from "./sequence";
import type { Contact, SequenceSettings } from "./types";

const seq: SequenceSettings = {
  dailyCap: 50,
  window: { start: "10:00", end: "18:00" },
  stopOnReply: true,
  em: { enabled: true, steps: [{ delayDays: 0 }, { delayDays: 2 }, { delayDays: 5 }] },
  wa: { enabled: true, steps: [{ delayDays: 0 }, { delayDays: 2 }, { delayDays: 5 }] },
};

function makeContact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: "c1",
    projectId: "p1",
    name: "Acme",
    email: "a@acme.com",
    phone: "9876543210",
    em_stage: 0,
    em_status: "not_contacted",
    wa_stage: 0,
    wa_status: "not_contacted",
    ...overrides,
  };
}

describe("nextDue", () => {
  it("returns step 0 immediately for a fresh contact", () => {
    const c = makeContact();
    const d = nextDue(c, "em", seq);
    expect(d).toMatchObject({ step: 0, valid: true });
  });

  it("returns null once all steps are sent", () => {
    const c = makeContact({ em_stage: 3, em_status: "completed" });
    expect(nextDue(c, "em", seq)).toBeNull();
  });

  it("returns null for terminal statuses", () => {
    for (const status of ["replied", "opted_out", "invalid", "bounced", "failed"] as const) {
      const c = makeContact({ em_status: status });
      expect(nextDue(c, "em", seq)).toBeNull();
    }
  });

  it("respects stop-on-reply across channels", () => {
    const c = makeContact({ em_status: "replied", wa_status: "not_contacted" });
    expect(nextDue(c, "wa", seq)).toBeNull();
  });

  it("schedules follow-ups delayDays after the last send", () => {
    const last = new Date("2026-01-01T00:00:00.000Z");
    const c = makeContact({ em_stage: 1, em_status: "initial_sent", em_last: last.toISOString() });
    const d = nextDue(c, "em", seq)!;
    expect(d.step).toBe(1);
    expect(new Date(d.at).getTime()).toBe(last.getTime() + 2 * 864e5);
  });

  it("flags invalid contacts but still reports the due step", () => {
    const c = makeContact({ email: "not an email" });
    const d = nextDue(c, "em", seq)!;
    expect(d.valid).toBe(false);
  });

  it("disabled channel never produces a due step", () => {
    const disabled: SequenceSettings = { ...seq, em: { ...seq.em, enabled: false } };
    const c = makeContact();
    expect(nextDue(c, "em", disabled)).toBeNull();
  });
});

describe("dueList", () => {
  it("only includes steps whose due time has passed", () => {
    const emOnly: SequenceSettings = { ...seq, wa: { ...seq.wa, enabled: false } };
    const future = makeContact({
      id: "future",
      em_stage: 1,
      em_status: "initial_sent",
      em_last: new Date().toISOString(),
    });
    const due = makeContact({ id: "due" });
    const result = dueList([future, due], emOnly);
    expect(result.map((d) => d.contactId)).toContain("due");
    expect(result.map((d) => d.contactId)).not.toContain("future");
  });
});
