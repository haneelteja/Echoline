import type { Contact as CoreContact, SequenceSettings as CoreSequenceSettings } from "@echoline/core";
import type { ContactRow, SequenceSettingsRow } from "@echoline/db";

export function toCoreContact(c: ContactRow): CoreContact {
  return {
    id: c.id,
    projectId: c.project_id,
    name: c.name,
    contactPerson: c.contact_person,
    category: c.category,
    area: c.area,
    phone: c.phone,
    email: c.email,
    source: c.source,
    demo: c.demo,
    em_stage: c.em_stage,
    em_status: c.em_status,
    em_last: c.em_last,
    em_track: c.em_track,
    wa_stage: c.wa_stage,
    wa_status: c.wa_status,
    wa_last: c.wa_last,
    wa_track: c.wa_track,
  };
}

export function toCoreSequence(s: SequenceSettingsRow): CoreSequenceSettings {
  return {
    dailyCap: s.daily_cap,
    window: { start: s.window_start.slice(0, 5), end: s.window_end.slice(0, 5) },
    stopOnReply: s.stop_on_reply,
    em: s.em,
    wa: s.wa,
  };
}
