import { afterEach, describe, expect, it, vi } from "vitest";
import { buildGoogleAuthUrl, exchangeGoogleCode, refreshGoogleToken } from "./oauth/google";
import { buildMicrosoftAuthUrl, exchangeMicrosoftCode, refreshMicrosoftToken } from "./oauth/microsoft";

const config = { clientId: "client-123", clientSecret: "secret-456", redirectUri: "https://api.echoline.app/oauth/gmail/callback" };

function mockTokenResponse(status: number, body: unknown) {
  const fn = vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Google OAuth", () => {
  it("builds an authorization URL with offline access and both scopes", () => {
    const url = new URL(buildGoogleAuthUrl(config, "state-abc"));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("client-123");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("state")).toBe("state-abc");
    expect(url.searchParams.get("scope")).toContain("gmail.send");
    expect(url.searchParams.get("scope")).toContain("gmail.readonly");
  });

  it("exchanges an authorization code for tokens", async () => {
    const fetchSpy = mockTokenResponse(200, {
      access_token: "ya29.access",
      refresh_token: "1//refresh",
      expires_in: 3599,
      scope: "gmail.send gmail.readonly",
    });
    const tokens = await exchangeGoogleCode(config, "auth-code-xyz");
    expect(tokens).toEqual({ accessToken: "ya29.access", refreshToken: "1//refresh", expiresIn: 3599, scope: "gmail.send gmail.readonly" });
    const [, init] = fetchSpy.mock.calls[0];
    const sentBody = new URLSearchParams(init.body as string);
    expect(sentBody.get("grant_type")).toBe("authorization_code");
    expect(sentBody.get("code")).toBe("auth-code-xyz");
  });

  it("throws with the provider's error on a failed exchange", async () => {
    mockTokenResponse(400, { error: "invalid_grant", error_description: "Code was already redeemed" });
    await expect(exchangeGoogleCode(config, "stale-code")).rejects.toThrow(/invalid_grant/);
  });

  it("preserves the original refresh token on refresh (Google never rotates it)", async () => {
    mockTokenResponse(200, { access_token: "ya29.new", expires_in: 3599, scope: "gmail.send" });
    const tokens = await refreshGoogleToken(config, "1//original-refresh");
    expect(tokens.refreshToken).toBe("1//original-refresh");
    expect(tokens.accessToken).toBe("ya29.new");
  });
});

describe("Microsoft OAuth", () => {
  it("builds an authorization URL with offline_access and Mail scopes", () => {
    const url = new URL(buildMicrosoftAuthUrl(config, "state-abc"));
    expect(url.origin + url.pathname).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
    expect(url.searchParams.get("scope")).toContain("offline_access");
    expect(url.searchParams.get("scope")).toContain("Mail.Send");
    expect(url.searchParams.get("scope")).toContain("Mail.Read");
  });

  it("exchanges an authorization code for tokens", async () => {
    mockTokenResponse(200, { access_token: "eyJ.access", refresh_token: "M.refresh", expires_in: 3600, scope: "Mail.Send Mail.Read" });
    const tokens = await exchangeMicrosoftCode(config, "auth-code-xyz");
    expect(tokens).toEqual({ accessToken: "eyJ.access", refreshToken: "M.refresh", expiresIn: 3600, scope: "Mail.Send Mail.Read" });
  });

  it("rotates the refresh token when the provider returns a new one", async () => {
    mockTokenResponse(200, { access_token: "eyJ.new", refresh_token: "M.rotated", expires_in: 3600, scope: "Mail.Send" });
    const tokens = await refreshMicrosoftToken(config, "M.original");
    expect(tokens.refreshToken).toBe("M.rotated");
  });

  it("falls back to the original refresh token if the provider omits one", async () => {
    mockTokenResponse(200, { access_token: "eyJ.new", expires_in: 3600, scope: "Mail.Send" });
    const tokens = await refreshMicrosoftToken(config, "M.original");
    expect(tokens.refreshToken).toBe("M.original");
  });

  it("throws with the provider's error on a failed refresh", async () => {
    mockTokenResponse(400, { error: "invalid_grant", error_description: "Refresh token expired" });
    await expect(refreshMicrosoftToken(config, "M.expired")).rejects.toThrow(/invalid_grant/);
  });
});
