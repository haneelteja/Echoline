export interface SheetData {
  headers: string[];
  rows: string[][];
}

/**
 * Reads an Excel table via Microsoft Graph — the same workbook-path + table
 * shape the original Make.com scenario used. `path` is the drive-relative
 * file path (e.g. "/ABS/Elma_Industries_MASTER_Leads.xlsx"), `table` is the
 * named Excel table within it (Excel's own "Format as Table" name, not a
 * sheet name).
 */
export async function readOneDriveTable(accessToken: string, path: string, table: string): Promise<SheetData> {
  const base = `https://graph.microsoft.com/v1.0/me/drive/root:${encodeURI(path)}:/workbook/tables/${encodeURIComponent(table)}`;
  const [headerRes, rowsRes] = await Promise.all([
    fetch(`${base}/headerRowRange`, { headers: { Authorization: `Bearer ${accessToken}` } }),
    fetch(`${base}/rows`, { headers: { Authorization: `Bearer ${accessToken}` } }),
  ]);
  if (!headerRes.ok) throw new Error(`Graph headerRowRange failed (${headerRes.status}): ${await headerRes.text().catch(() => "")}`);
  if (!rowsRes.ok) throw new Error(`Graph rows failed (${rowsRes.status}): ${await rowsRes.text().catch(() => "")}`);

  const headerData = (await headerRes.json()) as { values?: string[][] };
  const rowsData = (await rowsRes.json()) as { value?: { values?: unknown[][] }[] };
  const headers = (headerData.values?.[0] ?? []).map(String);
  const rows = (rowsData.value ?? []).map((r) => (r.values?.[0] ?? []).map((c) => (c == null ? "" : String(c))));
  return { headers, rows };
}
