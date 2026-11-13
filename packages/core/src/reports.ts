import ExcelJS from "exceljs";

/** Minimal shape report-building needs — deliberately not the shared
 * `Contact` type (camelCase, built for the sequence engine): callers query
 * raw snake_case rows straight from Supabase, and this only needs a handful
 * of those columns. */
export interface ReportContactRow {
  name: string;
  email: string | null;
  phone: string | null;
  category: string | null;
  area: string | null;
  source: string | null;
  created_at: string;
}

export interface ReportTable {
  headers: string[];
  rows: string[][];
}

/** Date (YYYY-MM-DD) and time (HH:MM) of `at` (default now) in a given IANA
 * timezone — same Intl.DateTimeFormat technique as sequence.ts's
 * isWithinSendWindow. Used both to decide "is it this project's configured
 * send time yet, and has today's report already gone out" (localNow) and to
 * bucket an individual contact's created_at into "today" without needing to
 * compute an exact UTC midnight boundary for the timezone (localDate). */
export function localNow(timezone: string, at: Date = new Date()): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

export function localDate(iso: string, timezone: string): string {
  return localNow(timezone, new Date(iso)).date;
}

export function buildNewLeadsReport(contacts: ReportContactRow[]): ReportTable {
  return {
    headers: ["Name", "Email", "Phone", "Category", "Area", "Source", "Added"],
    rows: contacts.map((c) => [
      c.name,
      c.email ?? "",
      c.phone ?? "",
      c.category ?? "",
      c.area ?? "",
      c.source ?? "",
      new Date(c.created_at).toLocaleString(),
    ]),
  };
}

export function buildLeadsBySourceReport(contacts: ReportContactRow[]): ReportTable {
  const counts = new Map<string, number>();
  for (const c of contacts) {
    const key = c.source || "Unknown";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const rows = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([source, count]) => [source, String(count)]);
  return { headers: ["Source", "Leads"], rows };
}

/** Plain inline-styled HTML table — same color tokens/fonts as
 * apps/api/src/platformEmail.ts's invite email, so this doesn't read as a
 * different product. */
export function renderReportHtmlTable(report: ReportTable, title: string): string {
  const headerCells = report.headers.map((h) => `<th style="text-align:left;padding:8px 12px;background:#F3F5F8;color:#4A5468;font-size:12px;text-transform:uppercase;letter-spacing:0.04em;border-bottom:1px solid #E6E3F0;">${escapeHtml(h)}</th>`).join("");
  const bodyRows = report.rows.length
    ? report.rows
        .map(
          (row, i) =>
            `<tr style="background:${i % 2 === 0 ? "#FFFFFF" : "#FAFAFC"};">${row
              .map((cell) => `<td style="padding:8px 12px;font-size:13px;color:#172033;border-bottom:1px solid #F3F5F8;">${escapeHtml(cell)}</td>`)
              .join("")}</tr>`
        )
        .join("")
    : `<tr><td colspan="${report.headers.length}" style="padding:16px 12px;font-size:13px;color:#7A8396;text-align:center;">No rows for this period.</td></tr>`;

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#F3F5F8;font-family:'Segoe UI',Manrope,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F5F8;padding:40px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" style="max-width:640px;background:#FFFFFF;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(23,32,51,0.08);">
            <tr>
              <td style="background:#172033;padding:28px 36px;">
                <span style="color:#FFFFFF;font-size:20px;font-weight:700;letter-spacing:-0.01em;">Echoline</span>
                <div style="color:#8C96AB;font-size:12px;margin-top:2px;">Email + WhatsApp outreach</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 36px;">
                <h1 style="margin:0 0 18px;font-size:20px;line-height:1.3;color:#172033;">${escapeHtml(title)}</h1>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                  <thead><tr>${headerCells}</tr></thead>
                  <tbody>${bodyRows}</tbody>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function renderReportPlainText(report: ReportTable, title: string): string {
  const lines = [title, "", report.headers.join("\t"), ...report.rows.map((r) => r.join("\t"))];
  return lines.join("\n");
}

/** A single-sheet .xlsx workbook as a Buffer, ready to attach. */
export async function buildReportWorkbook(report: ReportTable, sheetName: string): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  sheet.addRow(report.headers);
  sheet.getRow(1).font = { bold: true };
  for (const row of report.rows) sheet.addRow(row);
  sheet.columns.forEach((col) => {
    col.width = 22;
  });
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
