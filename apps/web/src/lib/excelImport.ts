import * as XLSX from "xlsx";

export interface ParsedSheet {
  headers: string[];
  rows: string[][];
}

export async function parseExcelFile(file: File): Promise<ParsedSheet> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const values = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, blankrows: false, defval: "" });
  const [headerRow, ...dataRows] = values;
  const headers = (headerRow ?? []).map((h) => String(h ?? "").trim());
  const rows = dataRows.map((r) => headers.map((_, i) => String(r[i] ?? "").trim()));
  return { headers, rows };
}

export const CONTACT_FIELDS = [
  { key: "name", label: "Business name", required: true, aliases: ["name", "business name", "company", "business"] },
  { key: "email", label: "Email", required: false, aliases: ["email", "e-mail", "email address"] },
  { key: "phone", label: "Phone", required: false, aliases: ["phone", "mobile", "whatsapp", "phone number", "contact number"] },
  { key: "category", label: "Category", required: false, aliases: ["category", "type", "segment"] },
  { key: "area", label: "Area", required: false, aliases: ["area", "location", "city", "region"] },
  { key: "contactPerson", label: "Contact person", required: false, aliases: ["contact person", "contact", "person", "poc"] },
] as const;

export type ContactFieldKey = (typeof CONTACT_FIELDS)[number]["key"];

/** Best-guess column mapping by case-insensitive header matching — the user
 * corrects any wrong guesses in the mapping dialog before import runs. */
export function guessColumnMapping(headers: string[]): Record<ContactFieldKey, string | null> {
  const mapping = {} as Record<ContactFieldKey, string | null>;
  const usedHeaders = new Set<string>();
  for (const field of CONTACT_FIELDS) {
    const aliases: readonly string[] = field.aliases;
    const match = headers.find((h) => !usedHeaders.has(h) && aliases.includes(h.toLowerCase().trim()));
    mapping[field.key] = match ?? null;
    if (match) usedHeaders.add(match);
  }
  return mapping;
}

export function applyColumnMapping(
  sheet: ParsedSheet,
  mapping: Record<ContactFieldKey, string | null>
): { name: string; email?: string; phone?: string; category?: string; area?: string; contactPerson?: string }[] {
  const indexOf = new Map(sheet.headers.map((h, i) => [h, i]));
  const colIndex = {} as Record<ContactFieldKey, number | undefined>;
  for (const field of CONTACT_FIELDS) {
    const header = mapping[field.key];
    colIndex[field.key] = header ? indexOf.get(header) : undefined;
  }

  const out: { name: string; email?: string; phone?: string; category?: string; area?: string; contactPerson?: string }[] = [];
  for (const row of sheet.rows) {
    const nameIdx = colIndex.name;
    const name = nameIdx !== undefined ? row[nameIdx] : "";
    if (!name) continue;
    out.push({
      name,
      email: colIndex.email !== undefined ? row[colIndex.email] : undefined,
      phone: colIndex.phone !== undefined ? row[colIndex.phone] : undefined,
      category: colIndex.category !== undefined ? row[colIndex.category] : undefined,
      area: colIndex.area !== undefined ? row[colIndex.area] : undefined,
      contactPerson: colIndex.contactPerson !== undefined ? row[colIndex.contactPerson] : undefined,
    });
  }
  return out;
}
