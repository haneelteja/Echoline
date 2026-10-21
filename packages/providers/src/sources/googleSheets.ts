import type { SheetData } from "./onedrive";

/** Lists tab (sheet) names in a spreadsheet, so callers can pick one instead
 * of guessing/typing it — e.g. "Sheet1" doesn't exist if the user renamed
 * their only tab. */
export async function listGoogleSheetTabs(accessToken: string, spreadsheetId: string): Promise<string[]> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties.title`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Google Sheets API failed (${res.status}): ${await res.text().catch(() => "")}`);
  const data = (await res.json()) as { sheets?: { properties?: { title?: string } }[] };
  return (data.sheets ?? []).map((s) => s.properties?.title).filter((t): t is string => Boolean(t));
}

/**
 * Reads a range via the Google Sheets API — first row of the range is
 * treated as the header row, matching how a typical lead sheet is laid out.
 * `range` follows Sheets' own A1 notation, e.g. "Sheet1!A1:F".
 */
export async function readGoogleSheet(accessToken: string, spreadsheetId: string, range: string): Promise<SheetData> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Google Sheets API failed (${res.status}): ${await res.text().catch(() => "")}`);
  const data = (await res.json()) as { values?: unknown[][] };
  const values = data.values ?? [];
  const headers = (values[0] ?? []).map(String);
  const rows = values.slice(1).map((r) => headers.map((_, i) => (r[i] == null ? "" : String(r[i]))));
  return { headers, rows };
}
