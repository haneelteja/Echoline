import { createHmac, createPublicKey, timingSafeEqual, verify as cryptoVerify, X509Certificate } from "node:crypto";

function timingSafeBufEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Resend webhooks are Svix-signed: secret is "whsec_<base64>", and the signed
 * content is "{id}.{timestamp}.{rawBody}" HMAC-SHA256'd, base64-encoded. The
 * header carries one or more "v1,<sig>" candidates (space-separated) to
 * support secret rotation — any match is accepted.
 */
export function verifySvixSignature(secret: string, svixId: string, svixTimestamp: string, rawBody: string, svixSignatureHeader: string): boolean {
  if (!secret.startsWith("whsec_")) return false;
  const secretBytes = Buffer.from(secret.slice("whsec_".length), "base64");
  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
  const expected = createHmac("sha256", secretBytes).update(signedContent).digest("base64");
  const expectedBuf = Buffer.from(expected, "base64");
  for (const candidate of svixSignatureHeader.split(" ")) {
    const [version, sig] = candidate.split(",");
    if (version !== "v1" || !sig) continue;
    try {
      if (timingSafeBufEqual(Buffer.from(sig, "base64"), expectedBuf)) return true;
    } catch {
      // malformed candidate, try the next
    }
  }
  return false;
}

/**
 * SendGrid's Signed Event Webhook: ECDSA (P-256) over "{timestamp}{rawBody}",
 * verified with the base64 DER public key shown in SendGrid's dashboard when
 * signing is enabled. Node's crypto.verify defaults to DER-encoded signatures,
 * which matches what SendGrid sends.
 */
export function verifySendGridSignature(publicKeyBase64: string, rawBody: string, signatureBase64: string, timestamp: string): boolean {
  try {
    const publicKey = createPublicKey({ key: Buffer.from(publicKeyBase64, "base64"), format: "der", type: "spki" });
    const payload = Buffer.from(timestamp + rawBody, "utf8");
    return cryptoVerify("sha256", payload, publicKey, Buffer.from(signatureBase64, "base64"));
  } catch {
    return false;
  }
}

/**
 * Meta Cloud API: HMAC-SHA256 of the raw body using the Meta App Secret
 * (app-level, not per-connection — one Meta App receives webhooks for every
 * WhatsApp Business number subscribed to it, regardless of which Echoline
 * project owns that number). Header is "sha256=<hex>".
 */
export function verifyMetaSignature(appSecret: string, rawBody: string, signatureHeader: string | undefined): boolean {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  try {
    return timingSafeBufEqual(Buffer.from(signatureHeader.slice("sha256=".length), "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

/**
 * Twilio: HMAC-SHA1 of (fullUrl + sorted "key"+"value" pairs from the
 * form-encoded POST body), base64-encoded, using the account's Auth Token.
 * fullUrl must be exactly the URL Twilio was configured to call.
 */
export function verifyTwilioSignature(authToken: string, fullUrl: string, params: Record<string, string>, signatureHeader: string | undefined): boolean {
  if (!signatureHeader) return false;
  let data = fullUrl;
  for (const key of Object.keys(params).sort()) data += key + params[key];
  const expected = createHmac("sha1", authToken).update(data, "utf8").digest("base64");
  try {
    return timingSafeBufEqual(Buffer.from(signatureHeader), Buffer.from(expected));
  } catch {
    return false;
  }
}

export interface SnsMessage {
  Type: string;
  MessageId: string;
  TopicArn: string;
  Subject?: string;
  Message: string;
  Timestamp: string;
  SignatureVersion: string;
  Signature: string;
  SigningCertURL: string;
  Token?: string;
  SubscribeURL?: string;
}

/**
 * AWS SES delivers bounce/complaint/delivery notifications via SNS, not a
 * shared-secret HMAC like every other provider here — each message carries
 * its own signature plus a URL to the X.509 cert that signed it. The cert
 * URL must be validated as genuinely AWS's (not just "fetch whatever URL the
 * request claims"), or a forged webhook could point us at an attacker's own
 * cert/key pair and sign whatever payload they want.
 */
export function isValidSnsCertUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && /^sns\.[a-z0-9-]+\.amazonaws\.com$/.test(u.hostname);
  } catch {
    return false;
  }
}

function snsCanonicalString(msg: SnsMessage): string {
  const isSubscription = msg.Type === "SubscriptionConfirmation" || msg.Type === "UnsubscribeConfirmation";
  const fields = isSubscription
    ? (["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"] as const)
    : (["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"] as const);
  let out = "";
  for (const field of fields) {
    const value = msg[field];
    if (value === undefined) continue; // Subject is only present on some Notification messages
    out += `${field}\n${value}\n`;
  }
  return out;
}

/**
 * fetchCert is injectable so this is unit-testable without a real network
 * call or a genuine AWS certificate — production callers can omit it to use
 * the real fetch.
 */
export async function verifySnsSignature(msg: SnsMessage, fetchCert: (url: string) => Promise<string> = (url) => fetch(url).then((r) => r.text())): Promise<boolean> {
  if (!isValidSnsCertUrl(msg.SigningCertURL)) return false;
  if (msg.SignatureVersion !== "1" && msg.SignatureVersion !== "2") return false;
  try {
    const certPem = await fetchCert(msg.SigningCertURL);
    const publicKey = new X509Certificate(certPem).publicKey;
    const canonical = Buffer.from(snsCanonicalString(msg), "utf8");
    const signature = Buffer.from(msg.Signature, "base64");
    return cryptoVerify(msg.SignatureVersion === "1" ? "sha1" : "sha256", canonical, publicKey, signature);
  } catch {
    return false;
  }
}
