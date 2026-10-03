import { createHmac, generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyMetaSignature, verifySendGridSignature, verifySvixSignature, verifyTwilioSignature } from "./verify";

describe("verifySvixSignature", () => {
  const secret = "whsec_" + Buffer.from("test-secret-bytes").toString("base64");
  const svixId = "msg_123";
  const svixTimestamp = "1700000000";
  const rawBody = '{"type":"email.delivered"}';

  function sign(): string {
    const secretBytes = Buffer.from(secret.slice("whsec_".length), "base64");
    const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
    const sig = createHmac("sha256", secretBytes).update(signedContent).digest("base64");
    return `v1,${sig}`;
  }

  it("accepts a correctly signed payload", () => {
    expect(verifySvixSignature(secret, svixId, svixTimestamp, rawBody, sign())).toBe(true);
  });

  it("accepts when the correct signature is among multiple space-separated candidates", () => {
    expect(verifySvixSignature(secret, svixId, svixTimestamp, rawBody, `v1,bogus== ${sign()}`)).toBe(true);
  });

  it("rejects a tampered body", () => {
    expect(verifySvixSignature(secret, svixId, svixTimestamp, '{"type":"email.bounced"}', sign())).toBe(false);
  });

  it("rejects a malformed secret", () => {
    expect(verifySvixSignature("not-a-whsec-secret", svixId, svixTimestamp, rawBody, sign())).toBe(false);
  });

  it("rejects a malformed signature header without throwing", () => {
    expect(verifySvixSignature(secret, svixId, svixTimestamp, rawBody, "garbage")).toBe(false);
  });
});

describe("verifySendGridSignature", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const publicKeyBase64 = publicKey.export({ format: "der", type: "spki" }).toString("base64");
  const rawBody = '[{"event":"delivered"}]';
  const timestamp = "1700000000";

  function sign(): string {
    return cryptoSign("sha256", Buffer.from(timestamp + rawBody, "utf8"), privateKey).toString("base64");
  }

  it("accepts a correctly signed payload", () => {
    expect(verifySendGridSignature(publicKeyBase64, rawBody, sign(), timestamp)).toBe(true);
  });

  it("rejects a tampered body", () => {
    expect(verifySendGridSignature(publicKeyBase64, '[{"event":"bounce"}]', sign(), timestamp)).toBe(false);
  });

  it("rejects an invalid public key without throwing", () => {
    expect(verifySendGridSignature("not-valid-base64-der", rawBody, sign(), timestamp)).toBe(false);
  });
});

describe("verifyMetaSignature", () => {
  const appSecret = "meta-app-secret";
  const rawBody = '{"object":"whatsapp_business_account"}';

  function sign(): string {
    return "sha256=" + createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  }

  it("accepts a correctly signed payload", () => {
    expect(verifyMetaSignature(appSecret, rawBody, sign())).toBe(true);
  });

  it("rejects a missing header", () => {
    expect(verifyMetaSignature(appSecret, rawBody, undefined)).toBe(false);
  });

  it("rejects a header without the sha256= prefix", () => {
    expect(verifyMetaSignature(appSecret, rawBody, "deadbeef")).toBe(false);
  });

  it("rejects a tampered body", () => {
    expect(verifyMetaSignature(appSecret, '{"object":"tampered"}', sign())).toBe(false);
  });
});

describe("verifyTwilioSignature", () => {
  const authToken = "twilio-auth-token";
  const fullUrl = "https://echoline-api.onrender.com/webhooks/whatsapp/twilio";
  const params = { MessageSid: "SM123", MessageStatus: "delivered", To: "whatsapp:+1500", From: "whatsapp:+1600" };

  function sign(): string {
    let data = fullUrl;
    for (const key of Object.keys(params).sort()) data += key + (params as Record<string, string>)[key];
    return createHmac("sha1", authToken).update(data, "utf8").digest("base64");
  }

  it("accepts a correctly signed payload", () => {
    expect(verifyTwilioSignature(authToken, fullUrl, params, sign())).toBe(true);
  });

  it("rejects a missing header", () => {
    expect(verifyTwilioSignature(authToken, fullUrl, params, undefined)).toBe(false);
  });

  it("rejects when a param was tampered with", () => {
    expect(verifyTwilioSignature(authToken, fullUrl, { ...params, MessageStatus: "failed" }, sign())).toBe(false);
  });

  it("rejects when the URL doesn't match what was signed", () => {
    expect(verifyTwilioSignature(authToken, fullUrl + "/extra", params, sign())).toBe(false);
  });
});
