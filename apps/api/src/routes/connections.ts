import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { decryptCredentials, encryptCredentials, envelopeToRow, loadMasterKey, rowToEnvelope } from "@echoline/db";
import { EMAIL_PROVIDER_IDS, WHATSAPP_PROVIDER_IDS, AI_PROVIDER_IDS, getConnectionTester, buildGoogleAuthUrl, buildMicrosoftAuthUrl } from "@echoline/providers";
import { sendDbError } from "../errors.js";
import { encodeOAuthState } from "../oauthState.js";
import { getOAuthConfig, isEmailOAuthProvider } from "../oauthProviders.js";

const ALL_PROVIDER_IDS = [...EMAIL_PROVIDER_IDS, ...WHATSAPP_PROVIDER_IDS, ...AI_PROVIDER_IDS] as const;

const createConnectionInput = z.object({
  kind: z.enum(["email", "whatsapp", "ai"]),
  provider: z.enum(ALL_PROVIDER_IDS),
  accountLabel: z.string().optional(),
  credentials: z.record(z.string()),
});

// Columns safe to return to the browser — never includes the encrypted
// credential/DEK columns. The API never returns secrets, only status.
const SAFE_COLUMNS =
  "id, project_id, kind, provider, account_label, scopes, status, needs_reconnect_reason, created_at, updated_at";

function masterKey() {
  return loadMasterKey(process.env.CREDENTIAL_VAULT_MASTER_KEY);
}

// Every route here runs through req.supabase (the caller's own RLS context,
// not a service-role bypass). provider_connections' RLS is admin-only — an
// operator calling GET gets an empty list, not an error; writes get a 403.
// That's intentional: connections management is an org-admin concern.
export const connectionRoutes: FastifyPluginAsync = async (app) => {
  app.get("/projects/:id/connections", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { data, error } = await req.supabase
      .from("provider_connections")
      .select(SAFE_COLUMNS)
      .eq("project_id", id)
      .order("created_at");
    if (error) return sendDbError(reply, error);
    return data;
  });

  app.post("/projects/:id/connections", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = createConnectionInput.parse(req.body);

    const emailProviders: readonly string[] = EMAIL_PROVIDER_IDS;
    const whatsappProviders: readonly string[] = WHATSAPP_PROVIDER_IDS;
    const expectedKind = emailProviders.includes(body.provider) ? "email" : whatsappProviders.includes(body.provider) ? "whatsapp" : "ai";
    if (body.kind !== expectedKind) {
      return reply.code(400).send({ error: "validation_error", message: `${body.provider} is a ${expectedKind} provider` });
    }

    const { data: project, error: projErr } = await req.supabase.from("projects").select("org_id").eq("id", id).maybeSingle();
    if (projErr) return sendDbError(reply, projErr);
    if (!project) return reply.code(404).send({ error: "not_found" });

    // Test before persisting so we never store credentials we know are bad,
    // and so the UI gets immediate feedback without a second round-trip.
    const tester = getConnectionTester(body.provider);
    const testResult = tester ? await tester(body.credentials) : { ok: false, error: "No tester registered for this provider" };

    const envelope = encryptCredentials(JSON.stringify(body.credentials), masterKey());
    const row = envelopeToRow(envelope);

    // Only one *connected* provider per (project, kind) — replace, don't stack.
    // Guarded on testResult.ok so a failed new attempt never disconnects a
    // working existing connection.
    if (testResult.ok) {
      await req.supabase
        .from("provider_connections")
        .update({ status: "disconnected" })
        .eq("project_id", id)
        .eq("kind", body.kind)
        .eq("status", "connected");
    }

    const { data, error } = await req.supabase
      .from("provider_connections")
      .insert({
        org_id: (project as any).org_id,
        project_id: id,
        kind: body.kind,
        provider: body.provider,
        account_label: body.accountLabel ?? testResult.accountLabel ?? null,
        status: testResult.ok ? "connected" : "disconnected",
        needs_reconnect_reason: testResult.ok ? null : testResult.error ?? null,
        ...row,
      })
      .select(SAFE_COLUMNS)
      .single();
    if (error) return sendDbError(reply, error);
    return reply.code(201).send({ ...data, testResult });
  });

  app.post("/projects/:projectId/connections/:connId/test", async (req, reply) => {
    const { projectId, connId } = req.params as { projectId: string; connId: string };
    const { data: conn, error } = await req.supabase
      .from("provider_connections")
      .select(
        "id, provider, encrypted_credentials, encryption_iv, encryption_tag, encrypted_dek, dek_iv, dek_tag"
      )
      .eq("project_id", projectId)
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
    const { data: updated, error: updateErr } = await req.supabase
      .from("provider_connections")
      .update({
        status: result.ok ? "connected" : "needs_reconnect",
        needs_reconnect_reason: result.ok ? null : result.error ?? null,
        account_label: result.accountLabel ?? (conn as any).account_label,
      })
      .eq("id", connId)
      .select(SAFE_COLUMNS)
      .single();
    if (updateErr) return sendDbError(reply, updateErr);
    return { ...updated, testResult: result };
  });

  // Returns the provider's consent-screen URL for the browser to navigate to
  // directly — the actual OAuth redirect never passes through our own fetch
  // layer, so the user's Supabase token travels here via the normal
  // Authorization header (not a URL), and only an encrypted copy of it rides
  // along in `state` for the callback (which has no header of its own) to use.
  app.post("/projects/:id/connections/oauth/:provider/start", async (req, reply) => {
    const { id, provider } = req.params as { id: string; provider: string };
    if (!isEmailOAuthProvider(provider)) {
      return reply.code(404).send({ error: "unknown_provider" });
    }
    const config = getOAuthConfig(provider);
    if (!config) {
      return reply.code(503).send({
        error: "oauth_not_configured",
        message: `${provider === "gmail" ? "Google" : "Microsoft"} OAuth credentials are not configured on the server.`,
      });
    }
    const accessToken = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    const state = encodeOAuthState({ projectId: id, accessToken });
    const url = provider === "gmail" ? buildGoogleAuthUrl(config, state) : buildMicrosoftAuthUrl(config, state);
    return { url };
  });

  app.delete("/projects/:projectId/connections/:connId", async (req, reply) => {
    const { projectId, connId } = req.params as { projectId: string; connId: string };
    const { error } = await req.supabase.from("provider_connections").delete().eq("project_id", projectId).eq("id", connId);
    if (error) return sendDbError(reply, error);
    return reply.code(204).send();
  });
};
