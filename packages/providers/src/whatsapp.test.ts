import { afterEach, describe, expect, it, vi } from "vitest";
import { testMeta, sendMetaTemplate, sendMetaText } from "./whatsapp/meta";
import { test360Dialog, send360DialogTemplate } from "./whatsapp/360dialog";
import { testGupshup, sendGupshupTemplate } from "./whatsapp/gupshup";
import { testInterakt, sendInteraktTemplate } from "./whatsapp/interakt";
import { testAiSensy, sendAiSensyTemplate } from "./whatsapp/aisensy";
import { testTwilio, sendTwilioTemplate, sendTwilioText } from "./whatsapp/twilio";
import type { WhatsAppTemplateMessage } from "./types";

const templateMessage: WhatsAppTemplateMessage = {
  to: "919876543210",
  templateName: "order_update",
  language: "en",
  components: [{ type: "body", parameters: [{ type: "text", text: "Acme Corp" }] }],
};

function mockFetchOnce(status: number, body: unknown) {
  const fn = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
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

describe("sendMetaTemplate", () => {
  it("sends with messaging_product, template name/language and body params", async () => {
    const fetchSpy = mockFetchOnce(200, { messages: [{ id: "wamid.123" }] });
    const result = await sendMetaTemplate({ accessToken: "EAAG...", phoneNumberId: "123456" }, templateMessage);
    expect(result).toEqual({ providerMessageId: "wamid.123" });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://graph.facebook.com/v19.0/123456/messages");
    const body = JSON.parse(init.body as string);
    expect(body.messaging_product).toBe("whatsapp");
    expect(body.template.name).toBe("order_update");
    expect(body.template.components[0].parameters[0].text).toBe("Acme Corp");
  });

  it("throws on a failed send", async () => {
    mockFetchOnce(401, { error: { message: "Error validating access token" } });
    await expect(sendMetaTemplate({ accessToken: "bad", phoneNumberId: "123456" }, templateMessage)).rejects.toThrow(/401/);
  });
});

describe("sendMetaText", () => {
  it("sends a plain text session message", async () => {
    const fetchSpy = mockFetchOnce(200, { messages: [{ id: "wamid.456" }] });
    const result = await sendMetaText({ accessToken: "EAAG...", phoneNumberId: "123456" }, { to: "919876543210", text: "Hi there" });
    expect(result).toEqual({ providerMessageId: "wamid.456" });
    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.type).toBe("text");
    expect(body.text.body).toBe("Hi there");
  });
});

describe("send360DialogTemplate", () => {
  it("sends with the D360-API-KEY header", async () => {
    const fetchSpy = mockFetchOnce(200, { messages: [{ id: "360-msg-1" }] });
    const result = await send360DialogTemplate({ apiKey: "d360-key" }, templateMessage);
    expect(result).toEqual({ providerMessageId: "360-msg-1" });
    const [, init] = fetchSpy.mock.calls[0];
    expect((init.headers as Record<string, string>)["D360-API-KEY"]).toBe("d360-key");
  });
});

describe("sendGupshupTemplate", () => {
  it("requires source (the registered sending number)", async () => {
    await expect(sendGupshupTemplate({ apiKey: "x", appId: "y" }, templateMessage)).rejects.toThrow(/source/);
  });

  it("sends as form-urlencoded with the template id and body params", async () => {
    const fetchSpy = mockFetchOnce(200, { messageId: "gs-msg-1" });
    const result = await sendGupshupTemplate({ apiKey: "gs-key", appId: "app-1", source: "916309060777" }, templateMessage);
    expect(result).toEqual({ providerMessageId: "gs-msg-1" });
    const [, init] = fetchSpy.mock.calls[0];
    const form = new URLSearchParams(init.body as string);
    expect(form.get("destination")).toBe("919876543210");
    expect(JSON.parse(form.get("template")!)).toEqual({ id: "order_update", params: ["Acme Corp"] });
  });
});

describe("sendInteraktTemplate", () => {
  it("sends with Basic auth and the template body values", async () => {
    const fetchSpy = mockFetchOnce(200, { id: "interakt-msg-1" });
    const result = await sendInteraktTemplate({ apiKey: "basic-token" }, templateMessage);
    expect(result).toEqual({ providerMessageId: "interakt-msg-1" });
    const [, init] = fetchSpy.mock.calls[0];
    expect((init.headers as Record<string, string>).Authorization).toBe("Basic basic-token");
    const body = JSON.parse(init.body as string);
    expect(body.template.bodyValues).toEqual(["Acme Corp"]);
  });
});

describe("sendAiSensyTemplate", () => {
  it("sends campaignName as the template name", async () => {
    const fetchSpy = mockFetchOnce(200, { submitted_message_id: "aisensy-msg-1" });
    const result = await sendAiSensyTemplate({ apiKey: "as-key" }, templateMessage);
    expect(result).toEqual({ providerMessageId: "aisensy-msg-1" });
    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.campaignName).toBe("order_update");
    expect(body.templateParams).toEqual(["Acme Corp"]);
  });
});

describe("sendTwilioTemplate", () => {
  it("sends via the Content API with ContentSid and ContentVariables", async () => {
    const fetchSpy = mockFetchOnce(200, { sid: "SM123" });
    const result = await sendTwilioTemplate(
      { accountSid: "AC123", authToken: "secret", fromNumber: "+14155551234" },
      templateMessage
    );
    expect(result).toEqual({ providerMessageId: "SM123" });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json");
    const form = new URLSearchParams(init.body as string);
    expect(form.get("From")).toBe("whatsapp:+14155551234");
    expect(form.get("To")).toBe("whatsapp:919876543210");
    expect(form.get("ContentSid")).toBe("order_update");
    expect(JSON.parse(form.get("ContentVariables")!)).toEqual({ "1": "Acme Corp" });
  });
});

describe("sendTwilioText", () => {
  it("sends a plain Body session message", async () => {
    mockFetchOnce(200, { sid: "SM456" });
    const result = await sendTwilioText(
      { accountSid: "AC123", authToken: "secret", fromNumber: "+14155551234" },
      { to: "919876543210", text: "Hi there" }
    );
    expect(result).toEqual({ providerMessageId: "SM456" });
  });

  it("requires fromNumber", async () => {
    await expect(sendTwilioText({ accountSid: "AC123", authToken: "secret" }, { to: "919876543210", text: "Hi" })).rejects.toThrow(
      /fromNumber/
    );
  });
});
