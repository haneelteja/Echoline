import { createAdminClient } from "@echoline/db";
import {
  buildLeadsBySourceReport,
  buildNewLeadsReport,
  buildReportWorkbook,
  buildSentMessagesReport,
  localDate,
  localNow,
  renderReportHtmlTable,
  renderReportPlainText,
  type ReportContactRow,
  type ReportSentEventRow,
  type ReportTable,
} from "@echoline/core";
import type { Logger } from "pino";
import { sendPlatformEmail } from "./platformEmail.js";

const REPORT_TITLE: Record<string, string> = {
  new_leads: "New leads",
  leads_by_source: "Leads by source",
  emails_sent: "Emails sent",
  whatsapp_sent: "WhatsApp messages sent",
};

const SENT_CHANNEL: Record<string, "em" | "wa"> = { emails_sent: "em", whatsapp_sent: "wa" };

interface SentEventContactJoin {
  occurred_at: string;
  contacts: { name: string; email: string | null; phone: string | null; area: string | null; source: string | null; raw_email: string | null; raw_phone: string | null } | null;
}

function toSentEventRows(events: SentEventContactJoin[], channel: "em" | "wa"): ReportSentEventRow[] {
  return events.map((ev) => {
    const c = ev.contacts;
    const to = channel === "em" ? c?.email || c?.raw_email || "" : c?.phone || c?.raw_phone || "";
    return { contactName: c?.name ?? "", to, area: c?.area ?? null, source: c?.source ?? null, occurredAt: ev.occurred_at };
  });
}

async function sendOneReport(
  db: ReturnType<typeof createAdminClient>,
  config: { id: string; project_id: string; report_type: string; recipient_email: string; format: string },
  timezone: string,
  today: string,
  log: Logger
): Promise<void> {
  let table: ReportTable;
  let rowCount: number;

  if (config.report_type === "emails_sent" || config.report_type === "whatsapp_sent") {
    const channel = SENT_CHANNEL[config.report_type];
    const { data: events, error } = await db
      .from("message_events")
      .select("occurred_at, contacts(name, email, phone, area, source, raw_email, raw_phone)")
      .eq("project_id", config.project_id)
      .eq("event_type", "sent")
      .eq("channel", channel);
    if (error) throw error;
    const todaysEvents = ((events as unknown as SentEventContactJoin[]) ?? []).filter((ev) => localDate(ev.occurred_at, timezone) === today);
    table = buildSentMessagesReport(toSentEventRows(todaysEvents, channel));
    rowCount = todaysEvents.length;
  } else {
    const { data: contacts, error } = await db
      .from("contacts")
      .select("name, email, phone, category, area, source, created_at")
      .eq("project_id", config.project_id);
    if (error) throw error;

    // Scheduled sends are always "today" (project-local calendar day) — the
    // interactive Reports page's arbitrary date range is a UI-only concern,
    // not something a daily digest config carries.
    const todaysContacts = ((contacts as ReportContactRow[]) ?? []).filter((c) => localDate(c.created_at, timezone) === today);
    table = config.report_type === "new_leads" ? buildNewLeadsReport(todaysContacts) : buildLeadsBySourceReport(todaysContacts);
    rowCount = todaysContacts.length;
  }

  const title = `${REPORT_TITLE[config.report_type] ?? config.report_type} — ${today}`;

  if (config.format === "excel") {
    const buffer = await buildReportWorkbook(table, REPORT_TITLE[config.report_type] ?? config.report_type);
    await sendPlatformEmail({
      to: config.recipient_email,
      subject: title,
      html: renderReportHtmlTable({ headers: table.headers, rows: [] }, title).replace("No rows for this period.", "See the attached spreadsheet."),
      text: `${title}\n\nSee the attached spreadsheet.`,
      attachments: [
        {
          filename: `${config.report_type}.xlsx`,
          content: buffer.toString("base64"),
          contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
      ],
    });
  } else {
    await sendPlatformEmail({
      to: config.recipient_email,
      subject: title,
      html: renderReportHtmlTable(table, title),
      text: renderReportPlainText(table, title),
    });
  }

  log.info({ configId: config.id, projectId: config.project_id, reportType: config.report_type, rows: rowCount }, "report send: sent");
}

/**
 * Rides the same 5-minute scheduler tick as source sync/IMAP poll/etc. —
 * each enabled report_configs row is checked against its own project's
 * local time (not a global interval), same shape as sourceSync.ts's
 * isDue() but comparing a time-of-day instead of an elapsed interval.
 * last_sent_date is only updated on a successful send, so a transient
 * failure (e.g. a Resend outage) retries on the next tick instead of
 * silently skipping the rest of the day.
 */
export async function runReportSendTick(log: Logger): Promise<void> {
  const db = createAdminClient();
  const { data: configs, error } = await db.from("report_configs").select("*").eq("enabled", true);
  if (error) {
    log.error({ error }, "report send tick: failed to list configs");
    return;
  }

  for (const config of (configs as any[]) ?? []) {
    try {
      const { data: project } = await db.from("projects").select("timezone").eq("id", config.project_id).maybeSingle();
      const timezone = (project as { timezone: string } | null)?.timezone ?? "UTC";
      const { date, time } = localNow(timezone);
      const due = time >= config.send_time.slice(0, 5) && config.last_sent_date !== date;
      if (!due) continue;

      await sendOneReport(db, config, timezone, date, log);
      await db.from("report_configs").update({ last_sent_date: date }).eq("id", config.id);
    } catch (err) {
      log.error({ err, configId: config.id }, "report send tick: failed for config");
    }
  }
}
