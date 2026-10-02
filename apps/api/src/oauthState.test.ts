import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeOAuthState, encodeOAuthState } from "./oauthState.js";

beforeEach(() => {
  process.env.CREDENTIAL_VAULT_MASTER_KEY = Buffer.alloc(32, 7).toString("base64");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("OAuth state", () => {
  it("round-trips projectId and accessToken", () => {
    const state = encodeOAuthState({ projectId: "proj-123", accessToken: "user-jwt-xyz" });
    const decoded = decodeOAuthState(state);
    expect(decoded.projectId).toBe("proj-123");
    expect(decoded.accessToken).toBe("user-jwt-xyz");
  });

  it("produces a URL-safe string with no query-breaking characters", () => {
    const state = encodeOAuthState({ projectId: "proj-123", accessToken: "token.with/special+chars" });
    expect(state).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("never leaks the access token in plaintext within the encoded state", () => {
    const state = encodeOAuthState({ projectId: "proj-123", accessToken: "super-secret-token-value" });
    expect(state).not.toContain("super-secret-token-value");
  });

  it("rejects state older than the TTL", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const state = encodeOAuthState({ projectId: "proj-123", accessToken: "x" });
    vi.setSystemTime(new Date("2026-01-01T00:11:00Z")); // 11 minutes later, TTL is 10
    expect(() => decodeOAuthState(state)).toThrow(/expired/);
  });

  it("rejects garbage input instead of crashing the process", () => {
    expect(() => decodeOAuthState("not-valid-state")).toThrow();
  });
});
