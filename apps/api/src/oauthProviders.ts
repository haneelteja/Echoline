import { GMAIL_SCOPES, GOOGLE_SHEETS_SCOPES, ONEDRIVE_SCOPES, OUTLOOK_SCOPES, type OAuthConfig } from "@echoline/providers";

/**
 * Every provider connectable via the shared OAuth redirect flow — two
 * purposes (email send/read, lead-source read) on top of the same two
 * underlying apps (one Google Cloud OAuth app, one Azure App Registration).
 * Email and lead-source connections both reuse GOOGLE_OAUTH_CLIENT_ID/
 * MICROSOFT_OAUTH_CLIENT_ID — same registered app, different requested
 * scopes per purpose, not a separate app per purpose.
 */
export type OAuthableProvider = "gmail" | "outlook" | "onedrive" | "google_sheets";

interface OAuthProviderMeta {
  service: "google" | "microsoft";
  /** provider_connections.kind this flow results in. */
  kind: "email" | "onedrive" | "google_sheets";
  scopes: string[];
}

const OAUTH_PROVIDERS: Record<OAuthableProvider, OAuthProviderMeta> = {
  gmail: { service: "google", kind: "email", scopes: GMAIL_SCOPES },
  outlook: { service: "microsoft", kind: "email", scopes: OUTLOOK_SCOPES },
  onedrive: { service: "microsoft", kind: "onedrive", scopes: ONEDRIVE_SCOPES },
  google_sheets: { service: "google", kind: "google_sheets", scopes: GOOGLE_SHEETS_SCOPES },
};

export function isOAuthableProvider(provider: string): provider is OAuthableProvider {
  return provider in OAUTH_PROVIDERS;
}

export function oauthProviderMeta(provider: OAuthableProvider): OAuthProviderMeta {
  return OAUTH_PROVIDERS[provider];
}

function apiPublicUrl(): string {
  return process.env.API_PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 4000}`;
}

/** Returns null if the provider's client ID/secret aren't configured on this server. */
export function getOAuthConfig(provider: OAuthableProvider): OAuthConfig | null {
  const envPrefix = OAUTH_PROVIDERS[provider].service === "google" ? "GOOGLE" : "MICROSOFT";
  const clientId = process.env[`${envPrefix}_OAUTH_CLIENT_ID`];
  const clientSecret = process.env[`${envPrefix}_OAUTH_CLIENT_SECRET`];
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, redirectUri: `${apiPublicUrl()}/oauth/${provider}/callback` };
}

export function webPublicUrl(): string {
  return process.env.WEB_PUBLIC_URL ?? "http://localhost:3000";
}
