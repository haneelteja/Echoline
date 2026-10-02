import { afterEach, describe, expect, it, vi } from "vitest";
import { testMeta } from "./whatsapp/meta";
import { test360Dialog } from "./whatsapp/360dialog";
import { testGupshup } from "./whatsapp/gupshup";
import { testInterakt } from "./whatsapp/interakt";
import { testAiSensy } from "./whatsapp/aisensy";
import { testTwilio } from "./whatsapp/twilio";

function mockFetchOnce(status: number, body: unknown) {
  const fn = vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("testMeta", () => {
  it("requires accessToken and phoneNumberId", async () => {
    const result = await testMeta({ accessToken: "x" });
    expect(result.ok).toBe(false);
  });

  it("returns the WhatsApp display number on success", async () => {
    mockFetchOnce(200, { display_phone_number: "+91 63090 60777", verified_name: "Elma Industries" });
    const result = await testMeta({ accessToken: "EAAG...", phoneNumberId: "123456" });
    expect(result).toEqual({ ok: true, accountLabel: "+91 63090 60777" });
  });

  it("fails on an expired token", async () => {
    mockFetchOnce(401, { error: { message: "Error validating access token" } });
    const result = await testMeta({ accessToken: "expired", phoneNumberId: "123456" });
    expect(result.ok).toBe(false);
  });
});

describe("test360Dialog", () => {
  it("requires an apiKey", async () => {
    const result = await test360Dialog({});
    expect(result.ok).toBe(false);
  });

  it("succeeds when the webhook config endpoint responds", async () => {
    mockFetchOnce(200, {});
    const result = await test360Dialog({ apiKey: "d360-key" });
    expect(result.ok).toBe(true);
  });

  it("fails on a bad key", async () => {
    mockFetchOnce(401, {});
    const result = await test360Dialog({ apiKey: "bad" });
    expect(result.ok).toBe(false);
  });
});

describe("testGupshup", () => {
  it("requires apiKey and appId", async () => {
    const result = await testGupshup({ apiKey: "x" });
    expect(result.ok).toBe(false);
  });

  it("returns the app name on success", async () => {
    mockFetchOnce(200, { name: "ElmaBot" });
    const result = await testGupshup({ apiKey: "gs-key", appId: "app-123" });
    expect(result).toEqual({ ok: true, accountLabel: "ElmaBot" });
  });
});

describe("testInterakt", () => {
  it("requires an apiKey", async () => {
    const result = await testInterakt({});
    expect(result.ok).toBe(false);
  });

  it("returns the org name on success", async () => {
    mockFetchOnce(200, { name: "Elma Industries" });
    const result = await testInterakt({ apiKey: "basic-token" });
    expect(result).toEqual({ ok: true, accountLabel: "Elma Industries" });
  });
});

describe("testAiSensy", () => {
  it("requires an apiKey", async () => {
    const result = await testAiSensy({});
    expect(result.ok).toBe(false);
  });

  it("treats a 401 as an invalid key", async () => {
    mockFetchOnce(401, {});
    const result = await testAiSensy({ apiKey: "bad" });
    expect(result).toEqual({ ok: false, error: "Invalid API key" });
  });

  it("treats a non-auth error response as a valid key", async () => {
    mockFetchOnce(400, { message: "campaign not found" });
    const result = await testAiSensy({ apiKey: "good-key" });
    expect(result.ok).toBe(true);
  });
});

describe("testTwilio", () => {
  it("requires accountSid and authToken", async () => {
    const result = await testTwilio({ accountSid: "AC123" });
    expect(result.ok).toBe(false);
  });

  it("returns the account friendly_name on success", async () => {
    mockFetchOnce(200, { friendly_name: "Elma WhatsApp" });
    const result = await testTwilio({ accountSid: "AC123", authToken: "secret" });
    expect(result).toEqual({ ok: true, accountLabel: "Elma WhatsApp" });
  });

  it("fails on bad credentials", async () => {
    mockFetchOnce(401, {});
    const result = await testTwilio({ accountSid: "AC123", authToken: "bad" });
    expect(result.ok).toBe(false);
  });
});
