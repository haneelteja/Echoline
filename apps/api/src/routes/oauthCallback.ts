import type { FastifyPluginAsync } from "fastify";
import { createAnonClient, encryptCredentials, envelopeToRow, loadMasterKey } from "@echoline/db";
import { exchangeGoogleCode, exchangeMicrosoftCode, getConnectionTester, getGoogleAccountEmail } from "@echoline/providers";
import { decodeOAuthState } from "../oauthState.js";
import { getOAuthConfig, isOAuthableProvider, oauthProviderMeta, webPublicUrl } from "../oauthProviders.js";

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

    if (!isOAuthableProvider(provider)) {
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
    const { kind, service } = oauthProviderMeta(provider);
    // Email connections land back on Channels (where they're managed);
    // OneDrive/Sheets land on Sources, since that's where lead sources live.
    const returnPath = kind === "email" ? "/channels" : "/sources";
    if (!config) {
      return reply.redirect(`${webUrl}${returnPath}?oauth_error=oauth_not_configured`);
    }

    try {
      const tokens =
        service === "google" ? await exchangeGoogleCode(config, code) : await exchangeMicrosoftCode(config, code, oauthProviderMeta(provider).scopes);
      const credentials: Record<string, string> = {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken ?? "",
      };

      // getConnectionTester only covers email/whatsapp/AI send providers —
      // onedrive/google_sheets aren't sends, they're lead sources, so there's
      // no equivalent tester registered. A successful token exchange already
      // means Google/Microsoft validated the consent; trust that instead of
      // adding a parallel tester just for this.
      const tester = getConnectionTester(provider);
      const testResult = tester ? await tester(credentials) : { ok: true as const };

      // google_sheets has no tester (above) and is the one provider that
      // supports multiple simultaneous connections per project (one per
      // Google account) — resolving the account's email is what lets those
      // coexist instead of each new connect silently replacing the last.
      let accountLabel = (testResult as { accountLabel?: string }).accountLabel ?? null;
      if (provider === "google_sheets" && !accountLabel) {
        accountLabel = await getGoogleAccountEmail(tokens.accessToken);
      }

      const envelope = encryptCredentials(JSON.stringify(credentials), masterKey());
      const row = envelopeToRow(envelope);

      // Acts as the user who started the flow, under RLS — same as every
      // other write in this API. Not the service-role client.
      const supabase = createAnonClient(statePayload.accessToken);
      const { data: project } = await supabase.from("projects").select("org_id").eq("id", statePayload.projectId).maybeSingle();
      if (!project) {
        return reply.redirect(`${webUrl}${returnPath}?oauth_error=project_not_found`);
      }

      // Only one *connected* provider per (project, kind) — replace, don't
      // stack (e.g. re-running the Gmail OAuth flow shouldn't leave two
      // "connected" email providers for the worker to trip over). The one
      // exception: google_sheets with a resolved account email only replaces
      // a previous connection for that *same* email, so a second Google
      // account can be connected alongside the first instead of evicting it.
      if (testResult.ok) {
        let disconnectQuery = supabase
          .from("provider_connections")
          .update({ status: "disconnected" })
          .eq("project_id", statePayload.projectId)
          .eq("kind", kind)
          .eq("status", "connected");
        if (provider === "google_sheets" && accountLabel) {
          // ilike (no wildcards) rather than eq — Google accounts are
          // case-insensitive, and comparing case-exactly here would let a
          // mixed-case reconnect of the same account mint a second row
          // instead of replacing the first.
          disconnectQuery = disconnectQuery.ilike("account_label", accountLabel);
        }
        await disconnectQuery;
      }

      const { error: insertErr } = await supabase.from("provider_connections").insert({
        org_id: (project as any).org_id,
        project_id: statePayload.projectId,
        kind,
        provider,
        account_label: accountLabel,
        scopes: tokens.scope ? tokens.scope.split(" ") : [],
        status: testResult.ok ? "connected" : "needs_reconnect",
        needs_reconnect_reason: testResult.ok ? null : testResult.error ?? null,
        ...row,
      });
      if (insertErr) {
        req.log.error({ insertErr }, "Failed to store OAuth connection");
        return reply.redirect(`${webUrl}${returnPath}?oauth_error=storage_failed`);
      }

      return reply.redirect(`${webUrl}${returnPath}?oauth_connected=${provider}`);
    } catch (err) {
      req.log.error({ err }, "OAuth token exchange failed");
      return reply.redirect(`${webUrl}${returnPath}?oauth_error=token_exchange_failed`);
    }
  });
};
