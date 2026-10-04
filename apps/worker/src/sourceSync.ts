import {
  createAdminClient,
  decryptCredentials,
  encryptCredentials,
  envelopeToRow,
  loadMasterKey,
  rowToEnvelope,
} from "@echoline/db";
import { readOneDriveTable, readGoogleSheet, refreshGoogleToken, refreshMicrosoftToken, type SheetData } from "@echoline/providers";
import { normPhone, validEmail } from "@echoline/core";
import type { Logger } from "pino";

function masterKey() {
  return loadMasterKey(process.env.CREDENTIAL_VAULT_MASTER_KEY);
}

const SYNC_INTERVAL_MS: Record<string, number> = {
  "15 min": 15 * 60 * 1000,
  Hourly: 60 * 60 * 1000,
  Daily: 24 * 60 * 60 * 1000,
};

function isDue(lastSync: string | null, mode: string | null): boolean {
  const interval = SYNC_INTERVAL_MS[mode ?? "Hourly"] ?? SYNC_INTERVAL_MS.Hourly;
  if (!lastSync) return true;
  return Date.now() - new Date(lastSync).getTime() >= interval;
}

const COLUMN_ALIASES: Record<string, string[]> = {
  name: ["name", "business name", "company", "business"],
  email: ["email", "e-mail", "email address"],
  phone: ["phone", "mobile", "whatsapp", "phone number", "contact number"],
  category: ["category", "type", "segment"],
  area: ["area", "location", "city", "region"],
};

/** Matches sheet headers to our contact fields — an explicit columnMap in
 * the source's config wins; otherwise a best-effort case-insensitive guess
 * against common header spellings. */
function resolveColumnMap(headers: string[], explicit: Record<string, string> | undefined): Record<string, number> {
  const indexOf = new Map(headers.map((h, i) => [h.toLowerCase().trim(), i]));
  const map: Record<string, number> = {};
  for (const field of Object.keys(COLUMN_ALIASES)) {
    const explicitHeader = explicit?.[field];
    if (explicitHeader && indexOf.has(explicitHeader.toLowerCase().trim())) {
      map[field] = indexOf.get(explicitHeader.toLowerCase().trim())!;
      continue;
    }
    for (const alias of COLUMN_ALIASES[field]) {
      if (indexOf.has(alias)) {
        map[field] = indexOf.get(alias)!;
        break;
      }
    }
  }
  return map;
}

async function refreshSourceToken(
  db: ReturnType<typeof createAdminClient>,
  conn: { id: string; provider: string },
  credentials: Record<string, string>
): Promise<void> {
  const envPrefix = conn.provider === "onedrive" ? "MICROSOFT" : "GOOGLE";
  const clientId = process.env[`${envPrefix}_OAUTH_CLIENT_ID`];
  const clientSecret = process.env[`${envPrefix}_OAUTH_CLIENT_SECRET`];
  if (!clientId || !clientSecret || !credentials.refreshToken) return;
  try {
    const tokens =
      conn.provider === "onedrive"
        ? await refreshMicrosoftToken({ clientId, clientSecret }, credentials.refreshToken, ["offline_access", "Files.Read"])
        : await refreshGoogleToken({ clientId, clientSecret }, credentials.refreshToken);
    credentials.accessToken = tokens.accessToken;
    if (tokens.refreshToken) credentials.refreshToken = tokens.refreshToken;
    const envelope = encryptCredentials(JSON.stringify(credentials), masterKey());
    await db.from("provider_connections").update(envelopeToRow(envelope)).eq("id", conn.id);
  } catch (err) {
    await db
      .from("provider_connections")
      .update({ status: "needs_reconnect", needs_reconnect_reason: `Token refresh failed: ${err instanceof Error ? err.message : String(err)}` })
      .eq("id", conn.id);
    throw err;
  }
}

async function syncOneSource(db: ReturnType<typeof createAdminClient>, source: any, log: Logger): Promise<void> {
  const { data: conn } = await db
    .from("provider_connections")
    .select("*")
    .eq("project_id", source.project_id)
    .eq("kind", source.type)
    .eq("status", "connected")
    .maybeSingle();
  if (!conn) {
    log.warn({ sourceId: source.id }, "source sync: no connected provider for this project/kind, skipping");
    return;
  }

  const credentials = JSON.parse(decryptCredentials(rowToEnvelope(conn as any), masterKey()));
  await refreshSourceToken(db, conn as any, credentials);

  let sheet: SheetData;
  try {
    sheet =
      source.type === "onedrive"
        ? await readOneDriveTable(credentials.accessToken, source.config.path, source.config.table)
        : await readGoogleSheet(credentials.accessToken, source.config.spreadsheetId, source.config.range ?? "Sheet1");
  } catch (err) {
    log.error({ sourceId: source.id, err }, "source sync: failed to read sheet/table");
    await db.from("lead_sources").update({ last_sync: new Date().toISOString() }).eq("id", source.id);
    return;
  }

  const colMap = resolveColumnMap(sheet.headers, source.config.columnMap);
  if (colMap.name === undefined) {
    log.warn({ sourceId: source.id }, "source sync: no name column found, skipping sync");
    return;
  }

  let added = 0,
    skipped = 0,
    failed = 0;
  for (const row of sheet.rows) {
    const name = row[colMap.name]?.trim();
    if (!name) continue;
    const email = colMap.email !== undefined && validEmail(row[colMap.email]) ? row[colMap.email].trim() : null;
    const phone = colMap.phone !== undefined ? normPhone(row[colMap.phone]) || null : null;
    const category = colMap.category !== undefined ? row[colMap.category]?.trim() || null : null;
    const area = colMap.area !== undefined ? row[colMap.area]?.trim() || null : null;

    if (email || phone) {
      const [byEmail, byPhone] = await Promise.all([
        email ? db.from("contacts").select("id").eq("project_id", source.project_id).ilike("email", email).maybeSingle() : Promise.resolve({ data: null }),
        phone ? db.from("contacts").select("id").eq("project_id", source.project_id).eq("phone", phone).maybeSingle() : Promise.resolve({ data: null }),
      ]);
      if (byEmail.data ?? byPhone.data) {
        skipped++;
        continue;
      }
    }

    const { error } = await db.from("contacts").insert({
      org_id: source.org_id,
      project_id: source.project_id,
      name,
      email,
      phone,
      category,
      area,
      source: source.name,
      em_status: "not_contacted",
      wa_status: "not_contacted",
    });
    if (error) failed++;
    else added++;
  }

  await db
    .from("lead_sources")
    .update({ rows_added: source.rows_added + added, rows_skipped: source.rows_skipped + skipped, rows_failed: source.rows_failed + failed, last_sync: new Date().toISOString() })
    .eq("id", source.id);
  log.info({ sourceId: source.id, added, skipped, failed }, "source sync: complete");
}

/** Runs alongside the main scheduler tick — checks every onedrive/google_sheets
 * lead source for whether it's due (per its own mode: 15 min/Hourly/Daily),
 * syncing the ones that are. De-dup matches intake.ts's rule exactly: same
 * email or phone as an existing contact is skipped, status never overwritten. */
export async function runSourceSyncTick(log: Logger): Promise<void> {
  const db = createAdminClient();
  const { data: sources, error } = await db.from("lead_sources").select("*").in("type", ["onedrive", "google_sheets"]);
  if (error) {
    log.error({ error }, "source sync: failed to list sources");
    return;
  }
  for (const source of (sources as any[]) ?? []) {
    if (!isDue(source.last_sync, source.mode)) continue;
    try {
      await syncOneSource(db, source, log);
    } catch (err) {
      log.error({ err, sourceId: source.id }, "source sync: failed");
    }
  }
}

/** Manual "Sync now" trigger — bypasses isDue() since the user explicitly asked. */
export async function syncSourceNow(sourceId: string, log: Logger): Promise<void> {
  const db = createAdminClient();
  const { data: source, error } = await db.from("lead_sources").select("*").eq("id", sourceId).maybeSingle();
  if (error) throw error;
  if (!source) throw new Error("source not found");
  await syncOneSource(db, source as any, log);
}
