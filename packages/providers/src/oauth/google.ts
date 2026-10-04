import type { OAuthConfig, OAuthTokens } from "./types";

// Scopes per the Phase 2 spec: send + readonly (readonly needed for reply
// detection in Phase 4's Gmail history API / watch).
export const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/gmail.readonly"];
// Read-only is deliberate — this is a lead *source*, we only ever read rows
// from a sheet the user already owns, never write back to it.
export const GOOGLE_SHEETS_SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"];

export function buildGoogleAuthUrl(config: OAuthConfig, state: string, scopes: string[] = GMAIL_SCOPES): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    access_type: "offline", // required to get a refresh_token
    prompt: "consent", // forces refresh_token on repeat consent too
    scope: scopes.join(" "),
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  error?: string;
  error_description?: string;
}

async function tokenRequest(body: URLSearchParams): Promise<GoogleTokenResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = (await res.json()) as GoogleTokenResponse;
  if (!res.ok) {
    throw new Error(`Google OAuth error: ${data.error ?? res.status} ${data.error_description ?? ""}`.trim());
  }
  return data;
}

export async function exchangeGoogleCode(config: OAuthConfig, code: string): Promise<OAuthTokens> {
  const data = await tokenRequest(
    new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: config.redirectUri,
    })
  );
  return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: data.expires_in, scope: data.scope };
}

/** Google never rotates the refresh token on refresh — callers should keep the original. */
export async function refreshGoogleToken(
  config: Pick<OAuthConfig, "clientId" | "clientSecret">,
  refreshToken: string
): Promise<OAuthTokens> {
  const data = await tokenRequest(
    new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    })
  );
  return { accessToken: data.access_token, refreshToken, expiresIn: data.expires_in, scope: data.scope };
}
