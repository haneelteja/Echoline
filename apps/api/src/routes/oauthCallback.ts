import type { FastifyPluginAsync } from "fastify";
import { createAnonClient, encryptCredentials, envelopeToRow, loadMasterKey } from "@echoline/db";
import { exchangeGoogleCode, exchangeMicrosoftCode, getConnectionTester } from "@echoline/providers";
import { decodeOAuthState } from "../oauthState.js";
import { getOAuthConfig, isEmailOAuthProvider, webPublicUrl } from "../oauthProviders.js";

function masterKey() {
  return loadMasterKey(process.env.CREDENTIAL_VAULT_MASTER_KEY);
}

/**
 * Hit directly by the browser's redirect from Google/Microsoft after consent —
 * registered outside the /v1 authenticated prefix since this request carries
 * no Authorization header of its own. Auth context comes from the encrypted
 * `state` param instead (see oauthState.ts), which was minted by the
 * authenticated /start endpoint.
 */
export const oauthCallbackRoutes: FastifyPluginAsync = async (app) => {
  app.get("/oauth/:provider/callback", async (req, reply) => {
    const { provider } = req.params as { provider: string };
    const { code, state, error } = req.query as { code?: string; state?: string; error?: string };
    const webUrl = webPublicUrl();

    if (!isEmailOAuthProvider(provider)) {
      return reply.redirect(`${webUrl}/channels?oauth_error=unknown_provider`);
    }
    if (error) {
      return reply.redirect(`${webUrl}/channels?oauth_error=${encodeURIComponent(error)}`);
    }
    if (!code || !state) {
      return reply.redirect(`${webUrl}/channels?oauth_error=missing_code`);
    }

    let statePayload;
    try {
      statePayload = decodeOAuthState(state);
    } catch (err) {
      req.log.warn({ err }, "OAuth state decode/expiry failure");
      return reply.redirect(`${webUrl}/channels?oauth_error=invalid_or_expired_state`);
    }

    const config = getOAuthConfig(provider);
    if (!config) {
      return reply.redirect(`${webUrl}/channels?oauth_error=oauth_not_configured`);
    }

    try {
      const tokens = provider === "gmail" ? await exchangeGoogleCode(config, code) : await exchangeMicrosoftCode(config, code);
      const credentials: Record<string, string> = {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken ?? "",
      };

      const tester = getConnectionTester(provider);
      const testResult = tester ? await tester(credentials) : { ok: true as const };

      const envelope = encryptCredentials(JSON.stringify(credentials), masterKey());
      const row = envelopeToRow(envelope);

      // Acts as the user who started the flow, under RLS — same as every
      // other write in this API. Not the service-role client.
      const supabase = createAnonClient(statePayload.accessToken);
      const { data: project } = await supabase.from("projects").select("org_id").eq("id", statePayload.projectId).maybeSingle();
      if (!project) {
        return reply.redirect(`${webUrl}/channels?oauth_error=project_not_found`);
      }

      const { error: insertErr } = await supabase.from("provider_connections").insert({
        org_id: (project as any).org_id,
        project_id: statePayload.projectId,
        kind: "email",
        provider,
        account_label: testResult.accountLabel ?? null,
        scopes: tokens.scope ? tokens.scope.split(" ") : [],
        status: testResult.ok ? "connected" : "needs_reconnect",
        needs_reconnect_reason: testResult.ok ? null : testResult.error ?? null,
        ...row,
      });
      if (insertErr) {
        req.log.error({ insertErr }, "Failed to store OAuth connection");
        return reply.redirect(`${webUrl}/channels?oauth_error=storage_failed`);
      }

      return reply.redirect(`${webUrl}/channels?oauth_connected=${provider}`);
    } catch (err) {
      req.log.error({ err }, "OAuth token exchange failed");
      return reply.redirect(`${webUrl}/channels?oauth_error=token_exchange_failed`);
    }
  });
};
