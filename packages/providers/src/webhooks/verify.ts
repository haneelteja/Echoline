import { createHmac, createPublicKey, timingSafeEqual, verify as cryptoVerify } from "node:crypto";

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
