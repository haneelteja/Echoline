// Envelope encryption for provider_connections credentials.
//
// Each credential is encrypted with its own random 256-bit Data Encryption Key
// (DEK) using AES-256-GCM. The DEK itself is encrypted with the master key
// (CREDENTIAL_VAULT_MASTER_KEY, from env or KMS) and stored alongside. This
// means rotating the master key only requires re-wrapping DEKs, not
// re-encrypting every stored credential, and a compromised DEK only exposes
// one credential rather than the whole vault.
//
// Server-side only (apps/api, apps/worker) — never import this from apps/web.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // recommended for GCM
const DEK_LENGTH = 32; // 256 bits

export interface EncryptedPayload {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
}

export interface EncryptedEnvelope {
  credentials: EncryptedPayload;
  dek: EncryptedPayload;
}

/**
 * Row shape as it travels through PostgREST (what supabase-js actually sends
 * and receives for `bytea` columns): a "\x"-prefixed hex string, per
 * Postgres's own text representation of bytea — not a raw Buffer, and not
 * base64. A Buffer passed straight into `.insert()` would get JSON-stringified
 * as `{"type":"Buffer","data":[...]}`, which Postgres cannot cast to bytea.
 */
export interface EnvelopeRow {
  encrypted_credentials: string;
  encryption_iv: string;
  encryption_tag: string;
  encrypted_dek: string;
  dek_iv: string;
  dek_tag: string;
}

function toPgBytea(buf: Buffer): string {
  return "\\x" + buf.toString("hex");
}

function fromPgBytea(value: string | Buffer): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === "string" && value.startsWith("\\x")) {
    return Buffer.from(value.slice(2), "hex");
  }
  throw new Error(`Unexpected bytea representation: ${JSON.stringify(value)}`);
}

function encryptWithKey(plaintext: Buffer, key: Buffer): EncryptedPayload {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { ciphertext, iv, tag: cipher.getAuthTag() };
}

function decryptWithKey(payload: EncryptedPayload, key: Buffer): Buffer {
  const decipher = createDecipheriv(ALGORITHM, key, payload.iv);
  decipher.setAuthTag(payload.tag);
  return Buffer.concat([decipher.update(payload.ciphertext), decipher.final()]);
}

/** Loads and validates the master key from its base64 env representation. */
export function loadMasterKey(base64Key: string | undefined): Buffer {
  if (!base64Key) {
    throw new Error("CREDENTIAL_VAULT_MASTER_KEY is not set");
  }
  const key = Buffer.from(base64Key, "base64");
  if (key.length !== DEK_LENGTH) {
    throw new Error(
      `CREDENTIAL_VAULT_MASTER_KEY must decode to ${DEK_LENGTH} bytes, got ${key.length}. Generate one with: openssl rand -base64 32`
    );
  }
  return key;
}

export function encryptCredentials(plaintextJson: string, masterKey: Buffer): EncryptedEnvelope {
  const dek = randomBytes(DEK_LENGTH);
  const credentials = encryptWithKey(Buffer.from(plaintextJson, "utf8"), dek);
  const encryptedDek = encryptWithKey(dek, masterKey);
  return { credentials, dek: encryptedDek };
}

export function decryptCredentials(envelope: EncryptedEnvelope, masterKey: Buffer): string {
  const dek = decryptWithKey(envelope.dek, masterKey);
  return decryptWithKey(envelope.credentials, dek).toString("utf8");
}

export function envelopeToRow(envelope: EncryptedEnvelope): EnvelopeRow {
  return {
    encrypted_credentials: toPgBytea(envelope.credentials.ciphertext),
    encryption_iv: toPgBytea(envelope.credentials.iv),
    encryption_tag: toPgBytea(envelope.credentials.tag),
    encrypted_dek: toPgBytea(envelope.dek.ciphertext),
    dek_iv: toPgBytea(envelope.dek.iv),
    dek_tag: toPgBytea(envelope.dek.tag),
  };
}

export function rowToEnvelope(row: {
  encrypted_credentials: string | Buffer;
  encryption_iv: string | Buffer;
  encryption_tag: string | Buffer;
  encrypted_dek: string | Buffer;
  dek_iv: string | Buffer;
  dek_tag: string | Buffer;
}): EncryptedEnvelope {
  return {
    credentials: {
      ciphertext: fromPgBytea(row.encrypted_credentials),
      iv: fromPgBytea(row.encryption_iv),
      tag: fromPgBytea(row.encryption_tag),
    },
    dek: {
      ciphertext: fromPgBytea(row.encrypted_dek),
      iv: fromPgBytea(row.dek_iv),
      tag: fromPgBytea(row.dek_tag),
    },
  };
}
