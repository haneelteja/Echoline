import type { OAuthConfig, OAuthTokens } from "./types";

// Scopes per the Phase 2 spec: Mail.Send + Mail.Read. offline_access is
// required to get a refresh_token.
export const OUTLOOK_SCOPES = ["offline_access", "Mail.Send", "Mail.Read"];
// Read-only — OneDrive lead sync only ever reads a workbook the user
// already owns, never writes back to it.
export const ONEDRIVE_SCOPES = ["offline_access", "Files.Read"];

export function buildMicrosoftAuthUrl(config: OAuthConfig, state: string, scopes: string[] = OUTLOOK_SCOPES): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    response_mode: "query",
    scope: scopes.join(" "),
    state,
  });
  return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`;
}

interface MicrosoftTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  error?: string;
  error_description?: string;
}

async function tokenRequest(body: URLSearchParams): Promise<MicrosoftTokenResponse> {
  const res = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = (await res.json()) as MicrosoftTokenResponse;
  if (!res.ok) {
    throw new Error(`Microsoft OAuth error: ${data.error ?? res.status} ${data.error_description ?? ""}`.trim());
  }
  return data;
}

export async function exchangeMicrosoftCode(config: OAuthConfig, code: string, scopes: string[] = OUTLOOK_SCOPES): Promise<OAuthTokens> {
  const data = await tokenRequest(
    new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: config.redirectUri,
      scope: scopes.join(" "),
    })
  );
  return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: data.expires_in, scope: data.scope };
}

/** Microsoft rotates the refresh token on every refresh — callers must persist the new one. */
export async function refreshMicrosoftToken(
  config: Pick<OAuthConfig, "clientId" | "clientSecret">,
  refreshToken: string,
  scopes: string[] = OUTLOOK_SCOPES
): Promise<OAuthTokens> {
  const data = await tokenRequest(
    new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
      scope: scopes.join(" "),
    })
  );
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? refreshToken,
    expiresIn: data.expires_in,
    scope: data.scope,
  };
}
