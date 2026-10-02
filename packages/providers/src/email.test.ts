import { afterEach, describe, expect, it, vi } from "vitest";
import { testSendGrid } from "./email/sendgrid";
import { testBrevo } from "./email/brevo";
import { testGmail } from "./email/gmail";
import { testOutlook } from "./email/outlook";

function mockFetchOnce(status: number, body: unknown) {
  const fn = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("testSendGrid", () => {
  it("rejects missing apiKey without calling the network", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await testSendGrid({});
    expect(result.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns the account email on success", async () => {
    mockFetchOnce(200, { email: "sender@brand.com" });
    const result = await testSendGrid({ apiKey: "SG.xxx" });
    expect(result).toEqual({ ok: true, accountLabel: "sender@brand.com" });
  });

  it("surfaces a non-2xx response as a failure", async () => {
    mockFetchOnce(401, {});
    const result = await testSendGrid({ apiKey: "bad" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/401/);
  });
});

describe("testBrevo", () => {
  it("returns the account email on success", async () => {
    mockFetchOnce(200, { email: "team@brand.com", companyName: "Brand" });
    const result = await testBrevo({ apiKey: "xkeysib-xxx" });
    expect(result).toEqual({ ok: true, accountLabel: "team@brand.com" });
  });

  it("falls back to companyName when email is absent", async () => {
    mockFetchOnce(200, { companyName: "Brand" });
    const result = await testBrevo({ apiKey: "xkeysib-xxx" });
    expect(result.accountLabel).toBe("Brand");
  });

  it("fails on a bad key", async () => {
    mockFetchOnce(401, {});
    const result = await testBrevo({ apiKey: "bad" });
    expect(result.ok).toBe(false);
  });
});

describe("testGmail", () => {
  it("returns the Google account email", async () => {
    mockFetchOnce(200, { email: "owner@gmail.com" });
    const result = await testGmail({ accessToken: "ya29.xxx" });
    expect(result).toEqual({ ok: true, accountLabel: "owner@gmail.com" });
  });

  it("requires an access token", async () => {
    const result = await testGmail({});
    expect(result.ok).toBe(false);
  });
});

describe("testOutlook", () => {
  it("returns the Microsoft account mail", async () => {
    mockFetchOnce(200, { mail: "owner@outlook.com", userPrincipalName: "owner@tenant.onmicrosoft.com" });
    const result = await testOutlook({ accessToken: "eyJ.xxx" });
    expect(result.accountLabel).toBe("owner@outlook.com");
  });

  it("falls back to userPrincipalName when mail is null (common for personal MSAs)", async () => {
    mockFetchOnce(200, { mail: null, userPrincipalName: "owner@tenant.onmicrosoft.com" });
    const result = await testOutlook({ accessToken: "eyJ.xxx" });
    expect(result.accountLabel).toBe("owner@tenant.onmicrosoft.com");
  });
});
