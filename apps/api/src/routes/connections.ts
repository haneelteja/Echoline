import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { createAdminClient, decryptCredentials, encryptCredentials, envelopeToRow, loadMasterKey, rowToEnvelope } from "@echoline/db";
import {
  EMAIL_PROVIDER_IDS,
  WHATSAPP_PROVIDER_IDS,
  AI_PROVIDER_IDS,
  IMAP_PROVIDER_IDS,
  getConnectionTester,
  getEmailSender,
  getWhatsAppTextSender,
  buildGoogleAuthUrl,
  buildMicrosoftAuthUrl,
  refreshGoogleToken,
  refreshMicrosoftToken,
  registerWebhook360Messenger,
  fetchMetaPhoneQuality,
} from "@echoline/providers";
import { normPhone } from "@echoline/core";
import { sendDbError } from "../errors.js";
import { encodeOAuthState } from "../oauthState.js";
import { getOAuthConfig, isOAuthableProvider, oauthProviderMeta } from "../oauthProviders.js";

const ALL_PROVIDER_IDS = [...EMAIL_PROVIDER_IDS, ...WHATSAPP_PROVIDER_IDS, ...AI_PROVIDER_IDS, ...IMAP_PROVIDER_IDS] as const;

const createConnectionInput = z.object({
  kind: z.enum(["email", "whatsapp", "ai", "email_imap"]),
  provider: z.enum(ALL_PROVIDER_IDS),
  accountLabel: z.string().optional(),
  credentials: z.record(z.string()),
});

// Columns safe to return to the browser — never includes the encrypted
// credential/DEK columns. The API never returns secrets, only status.
const SAFE_COLUMNS =
  "id, org_id, kind, provider, account_label, connected_by_email, scopes, status, needs_reconnect_reason, webhook_warning, wa_quality_rating, wa_messaging_tier, wa_quality_checked_at, max_sends_per_minute, created_at, updated_at";

const rateLimitInput = z.object({ maxSendsPerMinute: z.number().int().min(1).max(10_000).nullable() });

function masterKey() {
  return loadMasterKey(process.env.CREDENTIAL_VAULT_MASTER_KEY);
}

/** Shared by the connect and manual-Test routes. Returns null on failure
 * (distinct from a successful-but-empty result) rather than a nulled-out
 * object, so each caller can decide what null means for its own write — the
 * connect route (a fresh insert) writes explicit nulls either way, while the
 * Test route (an update) uses null to mean "leave prior good data alone"
 * rather than clobbering it on a transient failure. The webhook handler and
 * waQualityPoll.ts (a different app) each have their own fetch+write, since
 * both also do a different DB write shape around the fetch. */
// Shared by /test, /test-send-email and /test-send-whatsapp — each of those
// can flip a previously-"disconnected" row back to "connected" (that's how a
// user picks a new "active" email/WhatsApp provider without re-entering
// credentials: test the one you want active). Without this, two rows of the
// same (org, kind) could end up "connected" at once, which breaks every
// code path that assumes at most one (e.g. whatsappWorker.ts's .maybeSingle()
// lookup). AI is exempt — multiple AI connections may usefully stay
// "connected" at once; see the connect route's own comment on this.
async function demoteSiblingConnections(supabase: any, orgId: string, kind: string, keepConnId?: string): Promise<void> {
  if (kind === "ai") return;
  let query = supabase.from("provider_connections").update({ status: "disconnected", webhook_warning: null }).eq("org_id", orgId).eq("kind", kind).eq("status", "connected");
  // The create route calls this before the new row exists yet (nothing to
  // exclude); /test calls it on an existing row it wants to keep connected.
  if (keepConnId) query = query.neq("id", keepConnId);
  await query;
}

async function safeFetchMetaQuality(
  credentials: Record<string, string>,
  log: { warn: (obj: unknown, msg: string) => void }
): Promise<{ qualityRating: string | null; messagingLimitTier: string | null } | null> {
  try {
    return await fetchMetaPhoneQuality(credentials);
  } catch (err) {
    log.warn({ err }, "failed to fetch Meta phone quality");
    return null;
  }
}

// Same refresh-unconditionally pattern as sendNow.ts/emailWorker.ts/
// templateTestSend.ts — kept as a small duplicate here rather than
// extracting a shared helper for one more call site.
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

const testSendEmailInput = z.object({
  to: z.string().email(),
  cc: z.string().email().optional(),
  subject: z.string().min(1),
  body: z.string().min(1),
});

const testSendWhatsAppInput = z.object({
  to: z.string().min(5),
  message: z.string().min(1),
});

// Every route here runs through req.supabase (the caller's own RLS context,
// not a service-role bypass). provider_connections' RLS is admin-only — a
// non-admin member calling GET gets an empty list, not an error; writes get
// a 403. That's intentional: connections management is an org-admin concern.
// Scoped by org, not project — one set of connections is shared by every
// project in the organization (see migration 0041_connections_org_scoped.sql).
export const connectionRoutes: FastifyPluginAsync = async (app) => {
  app.get("/orgs/:orgId/connections", async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const { data, error } = await req.supabase
      .from("provider_connections")
      .select(SAFE_COLUMNS)
      .eq("org_id", orgId)
      .order("created_at");
    if (error) return sendDbError(reply, error);
    return data;
  });

  app.post("/orgs/:orgId/connections", async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const body = createConnectionInput.parse(req.body);

    const emailProviders: readonly string[] = EMAIL_PROVIDER_IDS;
    const whatsappProviders: readonly string[] = WHATSAPP_PROVIDER_IDS;
    const imapProviders: readonly string[] = IMAP_PROVIDER_IDS;
    const expectedKind = emailProviders.includes(body.provider)
      ? "email"
      : whatsappProviders.includes(body.provider)
        ? "whatsapp"
        : imapProviders.includes(body.provider)
          ? "email_imap"
          : "ai";
    if (body.kind !== expectedKind) {
      return reply.code(400).send({ error: "validation_error", message: `${body.provider} is a ${expectedKind} provider` });
    }

    // Test before persisting so we never store credentials we know are bad,
    // and so the UI gets immediate feedback without a second round-trip.
    const tester = getConnectionTester(body.provider);
    const testResult = tester ? await tester(body.credentials) : { ok: false, error: "No tester registered for this provider" };

    const envelope = encryptCredentials(JSON.stringify(body.credentials), masterKey());
    const row = envelopeToRow(envelope);

    // Only one *connected* provider per (org, kind) for email/whatsapp —
    // those represent a single sending identity, so replace rather than
    // stack. AI is different: multiple AI providers can usefully stay
    // connected at once (e.g. Claude + GPT + a cheap OpenRouter model), so
    // it's exempt — aiTemplates.ts's getAiCredentials() picks whichever one
    // was connected/reconnected most recently when more than one qualifies.
    // Guarded on testResult.ok so a failed new attempt never disconnects a
    // working existing connection.
    if (testResult.ok) await demoteSiblingConnections(req.supabase, orgId, body.kind);

    // Unlike Meta/Twilio/360dialog (webhook URL configured in their own
    // dashboard), 360Messenger exposes a settings API for this — register it
    // now so inbound replies start flowing without the admin doing anything
    // provider-side. Best-effort: a registration failure shouldn't block
    // saving a credential that otherwise tested fine, but it's surfaced via
    // webhook_warning rather than silently logged — e.g. 360Messenger
    // returns 403 FEATURE_LOCKED when the account's plan doesn't include
    // webhooks, which previously only showed up as inbound replies never
    // arriving, with no indication why.
    let webhookWarning: string | null = null;
    if (testResult.ok && body.provider === "360messenger" && process.env.API_PUBLIC_URL) {
      try {
        await registerWebhook360Messenger(body.credentials.apiKey, `${process.env.API_PUBLIC_URL}/webhooks/whatsapp/360messenger`);
      } catch (err) {
        webhookWarning = `Inbound reply detection unavailable: ${err instanceof Error ? err.message : String(err)}`;
        req.log.warn({ err }, "360Messenger webhook registration failed on connect — retried on next manual Test");
      }
    }

    // Best-effort initial read so the Channels page shows real quality/tier
    // data immediately on connect, rather than appearing blank until the
    // next daily poll (waQualityPoll.ts) or the next phone_number_quality_update
    // webhook fires — neither of which is guaranteed to happen soon. A fresh
    // row has no prior data to preserve, so null (not attempted or failed)
    // just means explicit nulls here — unlike the Test route below.
    const quality = testResult.ok && body.provider === "meta" ? await safeFetchMetaQuality(body.credentials, req.log) : null;

    const { data, error } = await req.supabase
      .from("provider_connections")
      .insert({
        org_id: orgId,
        connected_by_email: req.userEmail,
        kind: body.kind,
        provider: body.provider,
        account_label: body.accountLabel ?? testResult.accountLabel ?? null,
        status: testResult.ok ? "connected" : "disconnected",
        needs_reconnect_reason: testResult.ok ? null : testResult.error ?? null,
        webhook_warning: webhookWarning,
        wa_quality_rating: quality?.qualityRating ?? null,
        wa_messaging_tier: quality?.messagingLimitTier ?? null,
        wa_quality_checked_at: quality ? new Date().toISOString() : null,
        ...row,
      })
      .select(SAFE_COLUMNS)
      .single();
    if (error) return sendDbError(reply, error);
    return reply.code(201).send({ ...data, testResult });
  });

  app.post("/orgs/:orgId/connections/:connId/test", async (req, reply) => {
    const { orgId, connId } = req.params as { orgId: string; connId: string };
    const { data: conn, error } = await req.supabase
      .from("provider_connections")
      .select(
        "id, kind, provider, encrypted_credentials, encryption_iv, encryption_tag, encrypted_dek, dek_iv, dek_tag"
      )
      .eq("org_id", orgId)
      .eq("id", connId)
      .maybeSingle();
    if (error) return sendDbError(reply, error);
    if (!conn) return reply.code(404).send({ error: "not_found" });

    const tester = getConnectionTester((conn as any).provider);
    if (!tester) return reply.code(400).send({ error: "no_tester", message: "No tester registered for this provider" });

    let credentials: Record<string, string>;
    try {
      const plaintext = decryptCredentials(rowToEnvelope(conn as any), masterKey());
      credentials = JSON.parse(plaintext);
    } catch {
      return reply.code(500).send({ error: "decrypt_failed", message: "Could not decrypt stored credentials" });
    }

    const result = await tester(credentials);
    let webhookWarning: string | null = null;
    if (result.ok && (conn as any).provider === "360messenger" && process.env.API_PUBLIC_URL) {
      try {
        await registerWebhook360Messenger(credentials.apiKey, `${process.env.API_PUBLIC_URL}/webhooks/whatsapp/360messenger`);
      } catch (err) {
        webhookWarning = `Inbound reply detection unavailable: ${err instanceof Error ? err.message : String(err)}`;
        req.log.warn({ err }, "360Messenger webhook registration failed on manual Test");
      }
    }
    const quality = result.ok && (conn as any).provider === "meta" ? await safeFetchMetaQuality(credentials, req.log) : null;
    if (result.ok) await demoteSiblingConnections(req.supabase, orgId, (conn as any).kind, connId);
    const { data: updated, error: updateErr } = await req.supabase
      .from("provider_connections")
      .update({
        status: result.ok ? "connected" : "needs_reconnect",
        needs_reconnect_reason: result.ok ? null : result.error ?? null,
        account_label: result.accountLabel ?? (conn as any).account_label,
        // Only touch webhook_warning for 360messenger, quality fields for
        // meta — other providers never set these, so leave their existing
        // (always-null) values alone rather than clobbering them on every
        // test of an unrelated provider.
        ...((conn as any).provider === "360messenger" ? { webhook_warning: webhookWarning } : {}),
        ...(quality ? { wa_quality_rating: quality.qualityRating, wa_messaging_tier: quality.messagingLimitTier, wa_quality_checked_at: new Date().toISOString() } : {}),
      })
      .eq("id", connId)
      .select(SAFE_COLUMNS)
      .single();
    if (updateErr) return sendDbError(reply, updateErr);
    return { ...updated, testResult: result };
  });

  // Unlike /test above (a lightweight credential/session check with nothing
  // sent anywhere), this actually sends a real email through this exact
  // connection to an address the caller chooses — the only way to confirm
  // end-to-end deliverability, not just that the API key is accepted.
  app.post("/orgs/:orgId/connections/:connId/test-send-email", async (req, reply) => {
    const { orgId, connId } = req.params as { orgId: string; connId: string };
    const body = testSendEmailInput.parse(req.body);

    const { data: conn, error } = await req.supabase
      .from("provider_connections")
      .select("*")
      .eq("org_id", orgId)
      .eq("id", connId)
      .eq("kind", "email")
      .maybeSingle();
    if (error) return sendDbError(reply, error);
    if (!conn) return reply.code(404).send({ error: "not_found" });

    const c = conn as { id: string; provider: string; account_label: string | null } & Record<string, unknown>;
    const sender = getEmailSender(c.provider);
    if (!sender) return reply.code(400).send({ error: "no_sender", message: `No sender implemented for provider ${c.provider}` });

    let credentials: Record<string, string>;
    try {
      credentials = JSON.parse(decryptCredentials(rowToEnvelope(conn as never), masterKey()));
    } catch {
      return reply.code(500).send({ error: "decrypt_failed", message: "Could not decrypt stored credentials" });
    }

    const db = createAdminClient();
    try {
      await ensureFreshOAuthToken(db, c, credentials);
    } catch (err) {
      return reply.code(502).send({ error: "oauth_refresh_failed", message: err instanceof Error ? err.message : String(err) });
    }

    // No single project to read a channel_settings.fromEmail override from —
    // this connection is shared across every project in the org now — so a
    // test send just uses whatever the connection itself resolves to. Real
    // sends still apply a project's own channel_settings override (see
    // emailWorker.ts), since that stays project-scoped.
    const fromEmail = credentials.fromEmail || c.account_label;
    if (!fromEmail) return reply.code(400).send({ error: "no_sender_email", message: "No from-email configured for this connection" });

    try {
      await sender(credentials, {
        from: fromEmail,
        to: body.to,
        cc: body.cc,
        subject: `[TEST] ${body.subject}`,
        html: `<p>${body.body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>")}</p>`,
        text: body.body,
      });
    } catch (err) {
      await req.supabase
        .from("provider_connections")
        .update({ status: "needs_reconnect", needs_reconnect_reason: err instanceof Error ? err.message : String(err) })
        .eq("id", connId);
      return reply.code(502).send({ error: "send_failed", message: err instanceof Error ? err.message : String(err) });
    }

    await demoteSiblingConnections(req.supabase, orgId, c.kind as string, connId);
    const { data: updated, error: updateErr } = await req.supabase
      .from("provider_connections")
      .update({ status: "connected", needs_reconnect_reason: null })
      .eq("id", connId)
      .select(SAFE_COLUMNS)
      .single();
    if (updateErr) return sendDbError(reply, updateErr);
    return { ...updated, ok: true };
  });

  // Same reasoning as test-send-email above, for WhatsApp's text-send path
  // (not the template path — a cold test message has no approved template
  // to send with, so only providers with a genuine free-text sender work
  // here; see TEXT_ONLY_WHATSAPP_PROVIDERS).
  app.post("/orgs/:orgId/connections/:connId/test-send-whatsapp", async (req, reply) => {
    const { orgId, connId } = req.params as { orgId: string; connId: string };
    const body = testSendWhatsAppInput.parse(req.body);

    const to = normPhone(body.to);
    if (!to) return reply.code(400).send({ error: "validation_error", message: "Enter a valid WhatsApp number (with country code)" });

    const { data: conn, error } = await req.supabase
      .from("provider_connections")
      .select("*")
      .eq("org_id", orgId)
      .eq("id", connId)
      .eq("kind", "whatsapp")
      .maybeSingle();
    if (error) return sendDbError(reply, error);
    if (!conn) return reply.code(404).send({ error: "not_found" });

    const c = conn as { id: string; provider: string } & Record<string, unknown>;
    const sender = getWhatsAppTextSender(c.provider);
    if (!sender) {
      return reply
        .code(400)
        .send({ error: "no_sender", message: `${c.provider} has no free-text sender — it can only send approved templates, which this quick test doesn't use.` });
    }

    let credentials: Record<string, string>;
    try {
      credentials = JSON.parse(decryptCredentials(rowToEnvelope(conn as never), masterKey()));
    } catch {
      return reply.code(500).send({ error: "decrypt_failed", message: "Could not decrypt stored credentials" });
    }

    try {
      await sender(credentials, { to, text: `[TEST] ${body.message}` });
    } catch (err) {
      await req.supabase
        .from("provider_connections")
        .update({ status: "needs_reconnect", needs_reconnect_reason: err instanceof Error ? err.message : String(err) })
        .eq("id", connId);
      return reply.code(502).send({ error: "send_failed", message: err instanceof Error ? err.message : String(err) });
    }

    await demoteSiblingConnections(req.supabase, orgId, c.kind as string, connId);
    const { data: updated, error: updateErr } = await req.supabase
      .from("provider_connections")
      .update({ status: "connected", needs_reconnect_reason: null })
      .eq("id", connId)
      .select(SAFE_COLUMNS)
      .single();
    if (updateErr) return sendDbError(reply, updateErr);
    return { ...updated, ok: true };
  });

  // Returns the provider's consent-screen URL for the browser to navigate to
  // directly — the actual OAuth redirect never passes through our own fetch
  // layer, so the user's Supabase token travels here via the normal
  // Authorization header (not a URL), and only an encrypted copy of it rides
  // along in `state` for the callback (which has no header of its own) to use.
  app.post("/orgs/:orgId/connections/oauth/:provider/start", async (req, reply) => {
    const { orgId, provider } = req.params as { orgId: string; provider: string };
    if (!isOAuthableProvider(provider)) {
      return reply.code(404).send({ error: "unknown_provider" });
    }
    const config = getOAuthConfig(provider);
    if (!config) {
      const service = oauthProviderMeta(provider).service === "google" ? "Google" : "Microsoft";
      return reply.code(503).send({ error: "oauth_not_configured", message: `${service} OAuth credentials are not configured on the server.` });
    }
    const accessToken = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    const state = encodeOAuthState({ orgId, accessToken });
    const { service, scopes } = oauthProviderMeta(provider);
    const url = service === "google" ? buildGoogleAuthUrl(config, state, scopes) : buildMicrosoftAuthUrl(config, state, scopes);
    return { url };
  });

  app.delete("/orgs/:orgId/connections/:connId", async (req, reply) => {
    const { orgId, connId } = req.params as { orgId: string; connId: string };
    const { error } = await req.supabase.from("provider_connections").delete().eq("org_id", orgId).eq("id", connId);
    if (error) return sendDbError(reply, error);
    return reply.code(204).send();
  });

  // Overrides the send-rate default a provider gets in apps/worker's/this
  // app's own rateLimit.ts (currently only 360Messenger has one) — null
  // clears back to that default. A plain column, not an encrypted
  // credential, so this is its own small route rather than going through
  // the credential-handling /test-style routes above.
  app.patch("/orgs/:orgId/connections/:connId/rate-limit", async (req, reply) => {
    const { orgId, connId } = req.params as { orgId: string; connId: string };
    const body = rateLimitInput.parse(req.body);
    const { data, error } = await req.supabase
      .from("provider_connections")
      .update({ max_sends_per_minute: body.maxSendsPerMinute })
      .eq("org_id", orgId)
      .eq("id", connId)
      .select(SAFE_COLUMNS)
      .maybeSingle();
    if (error) return sendDbError(reply, error);
    if (!data) return reply.code(404).send({ error: "not_found" });
    return data;
  });
};
