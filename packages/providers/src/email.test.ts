import { afterEach, describe, expect, it, vi } from "vitest";
import { testSendGrid, sendSendGrid } from "./email/sendgrid";
import { testBrevo, sendBrevo } from "./email/brevo";
import { testGmail, sendGmail } from "./email/gmail";
import { testOutlook, sendOutlook } from "./email/outlook";
import { testResend, sendResend } from "./email/resend";
import type { EmailMessage } from "./types";

const message: EmailMessage = {
  from: "sender@brand.com",
  to: "lead@customer.com",
  subject: "Hello",
  html: "<p>Hi</p>",
  text: "Hi",
  headers: { "List-Unsubscribe": "<https://x.test/u/1>" },
};

function mockFetchOnce(status: number, body: unknown, headers: Record<string, string> = {}) {
  const fn = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function mockFetchSequence(responses: { status: number; body: unknown }[]) {
  const fn = vi.fn();
  for (const r of responses) {
    fn.mockResolvedValueOnce({
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body,
      text: async () => JSON.stringify(r.body),
      headers: { get: () => null },
    });
  }
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

describe("testResend", () => {
  it("rejects missing apiKey without calling the network", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await testResend({});
    expect(result.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("succeeds on a valid key", async () => {
    mockFetchOnce(200, { data: [] });
    const result = await testResend({ apiKey: "re_xxx" });
    expect(result.ok).toBe(true);
  });

  it("surfaces a non-2xx response as a failure", async () => {
    mockFetchOnce(401, {});
    const result = await testResend({ apiKey: "bad" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/401/);
  });
});

describe("sendSendGrid", () => {
  it("sends with both text and html content, and reads the message id from the response header", async () => {
    const fetchSpy = mockFetchOnce(202, {}, { "x-message-id": "sg-msg-123" });
    const result = await sendSendGrid({ apiKey: "SG.xxx" }, message);
    expect(result).toEqual({ providerMessageId: "sg-msg-123" });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.sendgrid.com/v3/mail/send");
    const body = JSON.parse(init.body as string);
    expect(body.content).toEqual([
      { type: "text/plain", value: "Hi" },
      { type: "text/html", value: "<p>Hi</p>" },
    ]);
    expect(body.personalizations[0].headers).toEqual(message.headers);
  });

  it("throws on a failed send", async () => {
    mockFetchOnce(401, { errors: [{ message: "bad key" }] });
    await expect(sendSendGrid({ apiKey: "bad" }, message)).rejects.toThrow(/401/);
  });
});

describe("sendBrevo", () => {
  it("sends and returns Brevo's messageId", async () => {
    mockFetchOnce(201, { messageId: "brevo-msg-456" });
    const result = await sendBrevo({ apiKey: "xkeysib-xxx" }, message);
    expect(result).toEqual({ providerMessageId: "brevo-msg-456" });
  });
});

describe("sendResend", () => {
  it("sends and returns Resend's id", async () => {
    mockFetchOnce(200, { id: "resend-msg-789" });
    const result = await sendResend({ apiKey: "re_xxx" }, message);
    expect(result).toEqual({ providerMessageId: "resend-msg-789" });
  });

  it("throws on a failed send", async () => {
    mockFetchOnce(422, { message: "invalid from address" });
    await expect(sendResend({ apiKey: "re_xxx" }, message)).rejects.toThrow(/422/);
  });
});

describe("sendGmail", () => {
  it("sends a base64url-encoded raw MIME message and returns Gmail's id", async () => {
    const fetchSpy = mockFetchOnce(200, { id: "gmail-msg-789" });
    const result = await sendGmail({ accessToken: "ya29.xxx" }, message);
    expect(result).toEqual({ providerMessageId: "gmail-msg-789" });
    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(typeof body.raw).toBe("string");
    // base64url round-trips back to a MIME message containing our content
    const decoded = Buffer.from(body.raw, "base64url").toString("utf8");
    expect(decoded).toContain("Hi</p>");
    expect(decoded).toContain("List-Unsubscribe:");
  });
});

describe("sendOutlook", () => {
  it("creates a draft then sends it, returning the draft's id as providerMessageId", async () => {
    const fetchSpy = mockFetchSequence([
      { status: 201, body: { id: "AAMk-draft-id" } },
      { status: 202, body: {} },
    ]);
    const result = await sendOutlook({ accessToken: "eyJ.xxx" }, message);
    expect(result).toEqual({ providerMessageId: "AAMk-draft-id" });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0][0]).toBe("https://graph.microsoft.com/v1.0/me/messages");
    expect(fetchSpy.mock.calls[1][0]).toBe("https://graph.microsoft.com/v1.0/me/messages/AAMk-draft-id/send");
  });
});
