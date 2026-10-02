import type { OAuthConfig } from "@echoline/providers";

export type EmailOAuthProvider = "gmail" | "outlook";

export function isEmailOAuthProvider(provider: string): provider is EmailOAuthProvider {
  return provider === "gmail" || provider === "outlook";
}

function apiPublicUrl(): string {
  return process.env.API_PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 4000}`;
}

/** Returns null if the provider's client ID/secret aren't configured on this server. */
export function getOAuthConfig(provider: EmailOAuthProvider): OAuthConfig | null {
  const envPrefix = provider === "gmail" ? "GOOGLE" : "MICROSOFT";
  const clientId = process.env[`${envPrefix}_OAUTH_CLIENT_ID`];
  const clientSecret = process.env[`${envPrefix}_OAUTH_CLIENT_SECRET`];
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, redirectUri: `${apiPublicUrl()}/oauth/${provider}/callback` };
}

export function webPublicUrl(): string {
  return process.env.WEB_PUBLIC_URL ?? "http://localhost:3000";
}
