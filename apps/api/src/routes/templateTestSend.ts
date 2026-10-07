import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { createAdminClient, decryptCredentials, encryptCredentials, envelopeToRow, loadMasterKey, rowToEnvelope, type ProjectRow } from "@echoline/db";
import { buildOpenPixelUrl, buildUnsubscribeUrl, getEmailSender, makeRewriteLink, refreshGoogleToken, refreshMicrosoftToken } from "@echoline/providers";
import { buildUnsubscribeHeaders, emailHTML, fill, fillPlainText } from "@echoline/core";
import { sendDbError } from "../errors.js";

function masterKey() {
  return loadMasterKey(process.env.CREDENTIAL_VAULT_MASTER_KEY);
}

function trackingConfig() {
  return { secret: process.env.TRACKING_SIGNING_SECRET ?? "", baseUrl: process.env.API_PUBLIC_URL ?? "" };
}

// Same refresh-unconditionally pattern as sendNow.ts/emailWorker.ts — kept as
// a small duplicate here rather than extracting a shared helper for one more
// call site.
async function ensureFreshOAuthToken(
  db: ReturnType<typeof createAdminClient>,
  conn: { id: string; provider: string },
  credentials: Record<string, string>
): Promise<void> {
  if (conn.provider !== "gmail" && conn.provider !== "outlook") return;
  const envPrefix = conn.provider === "gmail" ? "GOOGLE" : "MICROSOFT";
  const clientId = process.env[`${envPrefix}_OAUTH_CLIENT_ID`];
  const clientSecret = process.env[`${envPrefix}_OAUTH_CLIENT_SECRET`];
  if (!clientId || !clientSecret || !credentials.refreshToken) return;
  try {
    const tokens =
      conn.provider === "gmail"
        ? await refreshGoogleToken({ clientId, clientSecret }, credentials.refreshToken)
        : await refreshMicrosoftToken({ clientId, clientSecret }, credentials.refreshToken);
    credentials.accessToken = tokens.accessToken;
    if (tokens.refreshToken) credentials.refreshToken = tokens.refreshToken;
    const envelope = encryptCredentials(JSON.stringify(credentials), masterKey());
    await db.from("provider_connections").update(envelopeToRow(envelope)).eq("id", conn.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.from("provider_connections").update({ status: "needs_reconnect", needs_reconnect_reason: `Token refresh failed: ${message}` }).eq("id", conn.id);
    throw new Error(`OAuth token refresh failed for ${conn.provider}: ${message}`);
  }
}

const input = z.object({
  to: z.string().email(),
  subject: z.string().min(1),
  body: z.string().min(1),
  categoryLines: z.record(z.string()).optional(),
});

const SAMPLE_CONTACT = { name: "Acme Corp", contactPerson: null as string | null, area: "Gachibowli", category: "Restaurant" };

/**
 * Sends the email editor's current (possibly unsaved) draft to an address
 * the editor types in, so they can see real inbox rendering before saving —
 * distinct from sendNow.ts's per-lead send, which always needs a saved
 * template row plus a real contact. Uses the same placeholder contact data
 * as the in-editor preview. Deliberately NOT redirected by TEST_SEND_MODE —
 * that safety valve protects real leads from accidental sends; here the
 * admin chose this address on purpose, so it should go exactly there.
 *
 * Reads provider_connections through the caller's own req.supabase (RLS
 * admin-gated, same reasoning as aiTemplates.ts) so a non-admin simply gets
 * "no_connection" rather than a working send.
 */
export const templateTestSendRoutes: FastifyPluginAsync = async (app) => {
  app.post("/projects/:id/templates/send-test-email", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = input.parse(req.body);

    const { data: conn, error: connErr } = await req.supabase
      .from("provider_connections")
      .select("*")
      .eq("project_id", id)
      .eq("kind", "email")
      .eq("status", "connected")
      .maybeSingle();
    if (connErr) return sendDbError(reply, connErr);
    if (!conn) return reply.code(400).send({ error: "no_connection", message: "No connected email provider for this project" });

    const { data: project, error: projErr } = await req.supabase.from("projects").select("*").eq("id", id).maybeSingle();
    if (projErr) return sendDbError(reply, projErr);
    if (!project) return reply.code(404).send({ error: "not_found" });
    const p = project as ProjectRow;

    const c = conn as { id: string; provider: string; account_label: string | null } & Record<string, unknown>;
    const sender = getEmailSender(c.provider);
    if (!sender) return reply.code(400).send({ error: "no_sender", message: `No sender implemented for provider ${c.provider}` });

    const projectBrand = { name: p.name, brand: p.brand, senderName: p.sender_name, website: p.website, waNumber: p.wa_number, accent: p.accent };
    const ctx = { project: projectBrand, contact: SAMPLE_CONTACT, template: { body: body.body, categoryLines: body.categoryLines ?? {} } };

    const trackingKey = `test-${id}-${Date.now()}`;
    const tc = trackingConfig();
    const unsubscribeUrl = buildUnsubscribeUrl(tc, trackingKey);
    const html = emailHTML(
      { body: body.body },
      ctx,
      { logoUrl: null, galleryUrls: [] },
      { unsubscribeUrl, trackingPixelUrl: buildOpenPixelUrl(tc, trackingKey), rewriteLink: makeRewriteLink(tc, trackingKey) }
    );
    const text = fillPlainText(body.body, ctx, { unsubscribeUrl });
    const subject = `[TEST] ${fill(body.subject, ctx)}`;
    const headers = buildUnsubscribeHeaders(unsubscribeUrl);

    const db = createAdminClient();
    const credentials = JSON.parse(decryptCredentials(rowToEnvelope(conn as never), masterKey()));
    await ensureFreshOAuthToken(db, c, credentials);
    const { data: channelSettings } = await db.from("channel_settings").select("email").eq("project_id", id).maybeSingle();
    const emailSettings = ((channelSettings as { email?: Record<string, string> } | null)?.email ?? {}) as Record<string, string>;
    const fromEmail = emailSettings.fromEmail || credentials.fromEmail || c.account_label;
    if (!fromEmail) return reply.code(400).send({ error: "no_sender_email", message: "No from-email configured for this project's email connection" });

    try {
      await sender(credentials, { from: fromEmail, to: body.to, subject, html, text, headers });
      return { ok: true };
    } catch (err) {
      return reply.code(502).send({ error: "send_failed", message: err instanceof Error ? err.message : String(err) });
    }
  });
};
