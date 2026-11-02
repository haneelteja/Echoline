import type { SheetData } from "./onedrive";

/** Lists the actual Google Sheets files visible to this account (via the
 * Drive API, filtered to the native-Sheets mimeType — this is also why an
 * unconverted .xlsx never shows up here, only real Sheets documents do), so
 * the UI can offer a real picker instead of a pasted spreadsheet ID. Needs
 * the drive.metadata.readonly scope; never touches file contents. */
export async function listGoogleSheetFiles(accessToken: string): Promise<{ id: string; name: string }[]> {
  const params = new URLSearchParams({
    q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
    fields: "files(id,name)",
    orderBy: "modifiedTime desc",
    pageSize: "100",
  });
  const url = `https://www.googleapis.com/drive/v3/files?${params.toString()}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Google Drive API failed (${res.status}): ${await res.text().catch(() => "")}`);
  const data = (await res.json()) as { files?: { id?: string; name?: string }[] };
  return (data.files ?? []).filter((f): f is { id: string; name: string } => Boolean(f.id && f.name));
}

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
