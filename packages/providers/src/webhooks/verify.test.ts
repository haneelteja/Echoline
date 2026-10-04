import { createHmac, createPrivateKey, generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isValidSnsCertUrl, verifyMetaSignature, verifySendGridSignature, verifySnsSignature, verifySvixSignature, verifyTwilioSignature, type SnsMessage } from "./verify";

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

describe("isValidSnsCertUrl", () => {
  it("accepts a genuine AWS SNS cert host", () => {
    expect(isValidSnsCertUrl("https://sns.us-east-1.amazonaws.com/SimpleNotificationService-abc.pem")).toBe(true);
  });

  it("rejects a non-AWS host (the actual spoofing risk this guards against)", () => {
    expect(isValidSnsCertUrl("https://evil.example.com/sns.us-east-1.amazonaws.com.pem")).toBe(false);
  });

  it("rejects http (not https)", () => {
    expect(isValidSnsCertUrl("http://sns.us-east-1.amazonaws.com/cert.pem")).toBe(false);
  });

  it("rejects a malformed URL without throwing", () => {
    expect(isValidSnsCertUrl("not a url")).toBe(false);
  });
});

describe("verifySnsSignature", () => {
  // Self-signed 2048-bit RSA test cert/key, generated once for this suite —
  // not a real AWS certificate, only used to verify our own canonical-string
  // construction and signature-verification logic is internally consistent.
  const TEST_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCyTgFnrWL8NQgJ
IPVCqGS0hbzJXdbiI1c3mdVTFLziGG9rzdb65Soagea1QUeT04foROjD1rCiv1Dn
oaiYSM+sM0UkgagCdLG2sW+qKnR5cTMGs9cEfpymnUkxbNfumqKOHfRL1eF/xqO1
OMIdNDzRUaZOJZU9wMvqpaJQY+zYfbYNMghqYmqyiiU9t9KelN7XSvzWNAv2p4nR
uM0ZhLI76moXUcTZRnyF11SME1VT1ybc8SFSzGKdUST6kHW9mlxN/lyYQfWaNIqk
vRGykBpOV8DtX9hju11neq0vsGTo8y8+p2hL//ia8iDpfGXdkUBnVmsNmLGCnt+r
0gbyOfrHAgMBAAECggEABIBL51rWLQJP/3nazgZoPGlEdBKdX/M13yeZJy2f16Au
k1Fn8cii7nZgLnUy/YVahWQdqCdmlvwKRhoZWVI8FiiiUqLj2nZNr+ezpzrG2s8f
LsiPvN7hX34/jlduW3uBSr1w18eJvDQshqns22py47wkpjHP1RrTSwIjtLCuzT6K
FI/izBBdL3RfhXKgNLAw0fZ/Y1o1QNdjCXPGmqXrLWXBjVWPbKmc8CQVzcaG0gVA
vSIKPXMWm04NVvxu7dq0x4xwQuzYea7yRsW3Gepd5fmXOMYl8rjTTvt9AWlSQoJk
89v3b7kYBGXQeVV8ZtLYVL+SYonUJcjUtuQVIR+U6QKBgQDksBvZF3ca9RnEjEvW
ocpfDoSOBfcqhBWWslOceSoxUNUdhLtGCN0pj64xG+pGuWMVc1xOGCWDCqnXuUJi
8Tm3g6nA796wi5LR0yLCJ/jkZ3c3RbTJ/5ReR72RvGQmYx8ZIwDpFYZMKoTQoXP4
A0kGMIXUN7TRs7uM0DKKvOvmUwKBgQDHmXuz2ifiooRR/6xof1O3OO6LLOvFf7vy
PcCnBbxB75pbomXVw3O1gBI++wpOEi+On2tomz6u1iCJjVZxOzmeUX3ztnPDufKn
uxQyMtlgxvhQheDhj1YvuAIqaLP9j0x88jzgerhncG5UBC0e0q8aYRhMxCD0iU3h
vpuzugZjPQKBgFaoLUVMUQPUENmb2DkSwd7XX3953zkrKAscs/Y9K7HYUYmH/HcD
cNsI6RcO3u3B3jwIpNeq6rwHVGi8eN2JTzetGqxTuOzpVs9P1IICJ5xVYKV/MozA
3nYDdWA+JS0urmAWFYg9cdB25DEynQFELW29AVlzan90PgOT+TL9d96lAoGAT+Rn
Vz3i6RwTyp6D6+/LGnN3R83bMVpHaFa/Xhs1l07IghUmncF19xgkNYFWRpmQ341/
+IbrOCANNgGUsA38qhoESCCnhZhQQELpeo5P5CTAD7sGoEI3RTJp63+tS7in7Pso
0tFMLlsaTha92LCL1gs3JsL6TecHfWxF9lJnbCECgYEAmCRSFjwQsJtLHvhA9DBK
ayeEKNsEvkT8alRkXHqd78c4cojIej8FPi2NvHyaW+gRHZ4rBYVfkyEyTQqkk6MG
Vf3HZQ8HYXb2CdvK46wCKkllYvsgs/GDbApoEyg/pnjSh2koLEdM9P5BOn5e8v0d
TpnnyBtVU9fWt31UKqKzQdQ=
-----END PRIVATE KEY-----`;
  const TEST_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIDBzCCAe+gAwIBAgIUHSnpT3JgyY4+0olQizYBgAZOknAwDQYJKoZIhvcNAQEL
BQAwEzERMA8GA1UEAwwIc25zLXRlc3QwHhcNMjYxMDA0MDMxMzU2WhcNMzYxMDAx
MDMxMzU2WjATMREwDwYDVQQDDAhzbnMtdGVzdDCCASIwDQYJKoZIhvcNAQEBBQAD
ggEPADCCAQoCggEBALJOAWetYvw1CAkg9UKoZLSFvMld1uIjVzeZ1VMUvOIYb2vN
1vrlKhqB5rVBR5PTh+hE6MPWsKK/UOehqJhIz6wzRSSBqAJ0sbaxb6oqdHlxMwaz
1wR+nKadSTFs1+6aoo4d9EvV4X/Go7U4wh00PNFRpk4llT3Ay+qlolBj7Nh9tg0y
CGpiarKKJT230p6U3tdK/NY0C/anidG4zRmEsjvqahdRxNlGfIXXVIwTVVPXJtzx
IVLMYp1RJPqQdb2aXE3+XJhB9Zo0iqS9EbKQGk5XwO1f2GO7XWd6rS+wZOjzLz6n
aEv/+JryIOl8Zd2RQGdWaw2YsYKe36vSBvI5+scCAwEAAaNTMFEwHQYDVR0OBBYE
FN3PtrLtfpVvBSJa57vyOFwnupJKMB8GA1UdIwQYMBaAFN3PtrLtfpVvBSJa57vy
OFwnupJKMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAHVqqu/8
O5K+5b1Z7J3CaYh+y2ftVEMzhX/HFocJqTXYdshlWlA8BKyNhNa6b87pBapl1ywU
b7Y8RL04s60t6KIijdy5aV+WZUAaqKrOsTAHiuyfxK+R9EpaUdjHyGF6FFi/awq9
R9QG6sU1ZoFwgrH1qZkodmrf+OCN5azhBe4FbRV6xnVQrHIOtmatBcADntew0cCP
TQ1CSwdRO/dcrMuP7QecSNtceimaH+EsCwdxrFv/5Ids7qaXIPIqgTVEIv0bxqoJ
b522q6CDk2JmJCSO+rWssb61jJ8NwmUR/2Vvx9SVtWIV9Yj0+2H4y2YbTL89dbKY
mCc7EfNaGEv/O7M=
-----END CERTIFICATE-----`;

  const fetchCert = async () => TEST_CERT_PEM;
  const certUrl = "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-test.pem";

  function sign(canonical: string, algo: "sha1" | "sha256"): string {
    return cryptoSign(algo, Buffer.from(canonical, "utf8"), createPrivateKey(TEST_KEY_PEM)).toString("base64");
  }

  it("accepts a correctly signed Notification message (SignatureVersion 1)", async () => {
    const msg: Omit<SnsMessage, "Signature"> = {
      Type: "Notification",
      MessageId: "msg-1",
      TopicArn: "arn:aws:sns:us-east-1:123:topic",
      Message: '{"notificationType":"Bounce"}',
      Timestamp: "2024-01-01T00:00:00.000Z",
      SignatureVersion: "1",
      SigningCertURL: certUrl,
    };
    const canonical = `Message\n${msg.Message}\nMessageId\n${msg.MessageId}\nTimestamp\n${msg.Timestamp}\nTopicArn\n${msg.TopicArn}\nType\n${msg.Type}\n`;
    const Signature = sign(canonical, "sha1");
    expect(await verifySnsSignature({ ...msg, Signature }, fetchCert)).toBe(true);
  });

  it("accepts a correctly signed Notification message with a Subject (SignatureVersion 2)", async () => {
    const msg: Omit<SnsMessage, "Signature"> = {
      Type: "Notification",
      MessageId: "msg-2",
      Subject: "Amazon SES Email Event",
      TopicArn: "arn:aws:sns:us-east-1:123:topic",
      Message: '{"notificationType":"Complaint"}',
      Timestamp: "2024-01-01T00:00:00.000Z",
      SignatureVersion: "2",
      SigningCertURL: certUrl,
    };
    const canonical = `Message\n${msg.Message}\nMessageId\n${msg.MessageId}\nSubject\n${msg.Subject}\nTimestamp\n${msg.Timestamp}\nTopicArn\n${msg.TopicArn}\nType\n${msg.Type}\n`;
    const Signature = sign(canonical, "sha256");
    expect(await verifySnsSignature({ ...msg, Signature }, fetchCert)).toBe(true);
  });

  it("accepts a correctly signed SubscriptionConfirmation message", async () => {
    const msg: Omit<SnsMessage, "Signature"> = {
      Type: "SubscriptionConfirmation",
      MessageId: "msg-3",
      Token: "token-abc",
      TopicArn: "arn:aws:sns:us-east-1:123:topic",
      Message: "You have chosen to subscribe...",
      SubscribeURL: "https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&Token=token-abc",
      Timestamp: "2024-01-01T00:00:00.000Z",
      SignatureVersion: "1",
      SigningCertURL: certUrl,
    };
    const canonical = `Message\n${msg.Message}\nMessageId\n${msg.MessageId}\nSubscribeURL\n${msg.SubscribeURL}\nTimestamp\n${msg.Timestamp}\nToken\n${msg.Token}\nTopicArn\n${msg.TopicArn}\nType\n${msg.Type}\n`;
    const Signature = sign(canonical, "sha1");
    expect(await verifySnsSignature({ ...msg, Signature }, fetchCert)).toBe(true);
  });

  it("rejects a tampered message body", async () => {
    const msg: Omit<SnsMessage, "Signature"> = {
      Type: "Notification",
      MessageId: "msg-1",
      TopicArn: "arn:aws:sns:us-east-1:123:topic",
      Message: '{"notificationType":"Bounce"}',
      Timestamp: "2024-01-01T00:00:00.000Z",
      SignatureVersion: "1",
      SigningCertURL: certUrl,
    };
    const canonical = `Message\n${msg.Message}\nMessageId\n${msg.MessageId}\nTimestamp\n${msg.Timestamp}\nTopicArn\n${msg.TopicArn}\nType\n${msg.Type}\n`;
    const Signature = sign(canonical, "sha1");
    const tampered: SnsMessage = { ...msg, Signature, Message: '{"notificationType":"Delivery"}' };
    expect(await verifySnsSignature(tampered, fetchCert)).toBe(false);
  });

  it("rejects a non-AWS SigningCertURL even with an otherwise-valid signature", async () => {
    const msg: Omit<SnsMessage, "Signature"> = {
      Type: "Notification",
      MessageId: "msg-1",
      TopicArn: "arn:aws:sns:us-east-1:123:topic",
      Message: '{"notificationType":"Bounce"}',
      Timestamp: "2024-01-01T00:00:00.000Z",
      SignatureVersion: "1",
      SigningCertURL: "https://attacker.example.com/fake.pem",
    };
    const canonical = `Message\n${msg.Message}\nMessageId\n${msg.MessageId}\nTimestamp\n${msg.Timestamp}\nTopicArn\n${msg.TopicArn}\nType\n${msg.Type}\n`;
    const Signature = sign(canonical, "sha1");
    expect(await verifySnsSignature({ ...msg, Signature }, fetchCert)).toBe(false);
  });

  it("rejects an unsupported SignatureVersion", async () => {
    const msg: SnsMessage = {
      Type: "Notification",
      MessageId: "msg-1",
      TopicArn: "arn:aws:sns:us-east-1:123:topic",
      Message: '{"notificationType":"Bounce"}',
      Timestamp: "2024-01-01T00:00:00.000Z",
      SignatureVersion: "3",
      SigningCertURL: certUrl,
      Signature: "irrelevant",
    };
    expect(await verifySnsSignature(msg, fetchCert)).toBe(false);
  });
});
