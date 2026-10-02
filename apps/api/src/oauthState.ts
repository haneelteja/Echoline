import { decryptCredentials, encryptCredentials, loadMasterKey, type EncryptedEnvelope } from "@echoline/db";

const STATE_TTL_MS = 10 * 60 * 1000;

export interface OAuthStatePayload {
  projectId: string;
  /** The user's Supabase access token, so the callback (hit directly by the
   * provider's redirect, with no Authorization header of its own) can still
   * write the connection as that user, under RLS, exactly like every other
   * write in this API. Encrypting the whole state blob (not just signing it)
   * means this token is never visible in plaintext in our own request logs
   * or the provider's. */
  accessToken: string;
  iat: number;
}

function masterKey() {
  return loadMasterKey(process.env.CREDENTIAL_VAULT_MASTER_KEY);
}

function bufToB64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function b64urlToBuf(s: string): Buffer {
  return Buffer.from(s, "base64url");
}

export function encodeOAuthState(payload: Omit<OAuthStatePayload, "iat">): string {
  const full: OAuthStatePayload = { ...payload, iat: Date.now() };
  const envelope = encryptCredentials(JSON.stringify(full), masterKey());
  const packed = {
    c: bufToB64url(envelope.credentials.ciphertext),
    ci: bufToB64url(envelope.credentials.iv),
    ct: bufToB64url(envelope.credentials.tag),
    d: bufToB64url(envelope.dek.ciphertext),
    di: bufToB64url(envelope.dek.iv),
    dt: bufToB64url(envelope.dek.tag),
  };
  return bufToB64url(Buffer.from(JSON.stringify(packed)));
}

export function decodeOAuthState(state: string): OAuthStatePayload {
  const packed = JSON.parse(b64urlToBuf(state).toString("utf8"));
  const envelope: EncryptedEnvelope = {
    credentials: { ciphertext: b64urlToBuf(packed.c), iv: b64urlToBuf(packed.ci), tag: b64urlToBuf(packed.ct) },
    dek: { ciphertext: b64urlToBuf(packed.d), iv: b64urlToBuf(packed.di), tag: b64urlToBuf(packed.dt) },
  };
  const payload = JSON.parse(decryptCredentials(envelope, masterKey())) as OAuthStatePayload;
  if (Date.now() - payload.iat > STATE_TTL_MS) {
    throw new Error("OAuth state expired");
  }
  return payload;
}
