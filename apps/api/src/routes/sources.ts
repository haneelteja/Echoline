import type { FastifyPluginAsync } from "fastify";
import { randomBytes, createHash } from "node:crypto";
import {
  createAdminClient,
  decryptCredentials,
  encryptCredentials,
  envelopeToRow,
  loadMasterKey,
  rowToEnvelope,
} from "@echoline/db";
import { listGoogleSheetTabs, refreshGoogleToken } from "@echoline/providers";
import { sendDbError } from "../errors.js";
import { getSchedulerQueue } from "../schedulerQueue.js";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function masterKey() {
  return loadMasterKey(process.env.CREDENTIAL_VAULT_MASTER_KEY);
}

// Same unconditional-refresh pattern as connections.ts/sourceSync.ts — a
// short-lived access token rarely survives from "connect" to "first use."
async function refreshGoogleSheetsToken(
  db: ReturnType<typeof createAdminClient>,
  conn: { id: string },
  credentials: Record<string, string>
): Promise<void> {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret || !credentials.refreshToken) return;
  try {
    const tokens = await refreshGoogleToken({ clientId, clientSecret }, credentials.refreshToken);
    credentials.accessToken = tokens.accessToken;
    if (tokens.refreshToken) credentials.refreshToken = tokens.refreshToken;
    const envelope = encryptCredentials(JSON.stringify(credentials), masterKey());
    await db.from("provider_connections").update(envelopeToRow(envelope)).eq("id", conn.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.from("provider_connections").update({ status: "needs_reconnect", needs_reconnect_reason: `Token refresh failed: ${message}` }).eq("id", conn.id);
    throw new Error(`OAuth token refresh failed for google_sheets: ${message}`);
  }
}

/**
 * Issues (or rotates) the bearer token a webhook/form lead source uses to
 * authenticate with the public /intake/:sourceId endpoint. Only a hash is
 * stored (config.tokenHash) — the plaintext is returned once, here, same as
 * any API-key-issuance flow; losing it means generating a new one.
 */
export const sourcesRoutes: FastifyPluginAsync = async (app) => {
  app.post("/projects/:projectId/sources/:sourceId/token", async (req, reply) => {
    const { projectId, sourceId } = req.params as { projectId: string; sourceId: string };
    const { data: source, error: fetchErr } = await req.supabase
      .from("lead_sources")
      .select("id, type, config")
      .eq("project_id", projectId)
      .eq("id", sourceId)
      .maybeSingle();
    if (fetchErr) return sendDbError(reply, fetchErr);
    if (!source) return reply.code(404).send({ error: "not_found" });
    const s = source as { id: string; type: string; config: Record<string, unknown> };
    if (s.type !== "webhook" && s.type !== "form") {
      return reply.code(400).send({ error: "validation_error", message: "Only webhook/form sources use a token" });
    }

    const token = randomBytes(24).toString("base64url");
    const { error: updateErr } = await req.supabase
      .from("lead_sources")
      .update({ config: { ...s.config, tokenHash: hashToken(token) } })
      .eq("id", sourceId);
    if (updateErr) return sendDbError(reply, updateErr);

    return { token };
  });

  // Manual "Sync now" for onedrive/google_sheets sources — enqueues onto the
  // same scheduler queue the worker's repeatable tick uses (mirrors
  // projects.ts's run-due trigger), just scoped to one source by id.
  app.post("/projects/:projectId/sources/:sourceId/sync", async (req, reply) => {
    const { projectId, sourceId } = req.params as { projectId: string; sourceId: string };
    const { data: source, error: fetchErr } = await req.supabase
      .from("lead_sources")
      .select("id, type")
      .eq("project_id", projectId)
      .eq("id", sourceId)
      .maybeSingle();
    if (fetchErr) return sendDbError(reply, fetchErr);
    if (!source) return reply.code(404).send({ error: "not_found" });
    const s = source as { id: string; type: string };
    if (s.type !== "onedrive" && s.type !== "google_sheets") {
      return reply.code(400).send({ error: "validation_error", message: "Only onedrive/google_sheets sources can be synced" });
    }

    await getSchedulerQueue().add("manual-source-sync", { sourceId }, { removeOnComplete: 100, removeOnFail: 100 });
    return { ok: true };
  });

  // Lists the real tab names in a spreadsheet, so the UI can offer a picker
  // instead of free-text ("Sheet1" doesn't exist if the user renamed their
  // only tab — the exact failure this replaces). Uses an admin client for the
  // connection read since the OAuth-connected account belongs to whoever
  // clicked "Connect Google Sheets", not necessarily the caller.
  app.get("/projects/:projectId/sources/google-sheets/tabs", async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const { spreadsheetId } = req.query as { spreadsheetId?: string };
    if (!spreadsheetId) return reply.code(400).send({ error: "validation_error", message: "spreadsheetId is required" });

    const db = createAdminClient();
    const { data: conn, error: connErr } = await db
      .from("provider_connections")
      .select("*")
      .eq("project_id", projectId)
      .eq("kind", "google_sheets")
      .eq("status", "connected")
      .maybeSingle();
    if (connErr) return sendDbError(reply, connErr);
    if (!conn) return reply.code(400).send({ error: "no_connection", message: "Connect a Google Sheets account for this project first" });

    let credentials: Record<string, string>;
    try {
      credentials = JSON.parse(decryptCredentials(rowToEnvelope(conn as any), masterKey()));
    } catch {
      return reply.code(500).send({ error: "decrypt_failed" });
    }

    try {
      await refreshGoogleSheetsToken(db, conn as any, credentials);
      const tabs = await listGoogleSheetTabs(credentials.accessToken, spreadsheetId);
      return { tabs };
    } catch (err) {
      return reply.code(502).send({ error: "google_sheets_failed", message: err instanceof Error ? err.message : String(err) });
    }
  });
};
