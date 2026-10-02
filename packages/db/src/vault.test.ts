import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptCredentials, encryptCredentials, envelopeToRow, loadMasterKey, rowToEnvelope } from "./vault.js";

const masterKey = randomBytes(32);

describe("loadMasterKey", () => {
  it("accepts a valid base64-encoded 32-byte key", () => {
    const key = loadMasterKey(masterKey.toString("base64"));
    expect(key).toHaveLength(32);
  });

  it("rejects a missing key", () => {
    expect(() => loadMasterKey(undefined)).toThrow(/not set/);
  });

  it("rejects a key of the wrong length", () => {
    expect(() => loadMasterKey(Buffer.from("too-short").toString("base64"))).toThrow(/32 bytes/);
  });
});

describe("encryptCredentials / decryptCredentials", () => {
  it("round-trips arbitrary JSON", () => {
    const secret = JSON.stringify({ apiKey: "sk_live_abc123", accountSid: "AC123" });
    const envelope = encryptCredentials(secret, masterKey);
    expect(decryptCredentials(envelope, masterKey)).toBe(secret);
  });

  it("never stores the plaintext in the ciphertext bytes", () => {
    const secret = JSON.stringify({ apiKey: "sk_live_super_secret_value" });
    const envelope = encryptCredentials(secret, masterKey);
    expect(envelope.credentials.ciphertext.toString("utf8")).not.toContain("super_secret_value");
    expect(envelope.dek.ciphertext.toString("utf8")).not.toContain("super_secret_value");
  });

  it("produces a different DEK (and ciphertext) every time, even for the same plaintext", () => {
    const secret = JSON.stringify({ apiKey: "same-secret" });
    const a = encryptCredentials(secret, masterKey);
    const b = encryptCredentials(secret, masterKey);
    expect(a.dek.ciphertext.equals(b.dek.ciphertext)).toBe(false);
    expect(a.credentials.ciphertext.equals(b.credentials.ciphertext)).toBe(false);
  });

  it("fails to decrypt with the wrong master key", () => {
    const envelope = encryptCredentials(JSON.stringify({ apiKey: "x" }), masterKey);
    const wrongKey = randomBytes(32);
    expect(() => decryptCredentials(envelope, wrongKey)).toThrow();
  });

  it("fails to decrypt if the ciphertext is tampered with (GCM auth tag)", () => {
    const envelope = encryptCredentials(JSON.stringify({ apiKey: "x" }), masterKey);
    envelope.credentials.ciphertext[0] ^= 0xff;
    expect(() => decryptCredentials(envelope, masterKey)).toThrow();
  });

  it("survives a round-trip through the DB row shape", () => {
    const secret = JSON.stringify({ apiKey: "round-trip-me" });
    const envelope = encryptCredentials(secret, masterKey);
    const row = envelopeToRow(envelope);
    const restored = rowToEnvelope(row);
    expect(decryptCredentials(restored, masterKey)).toBe(secret);
  });

  it("stores each column as a Postgres bytea hex string, not a raw Buffer", () => {
    // Regression test: a Buffer passed straight into supabase-js's .insert()
    // gets JSON-stringified as {"type":"Buffer","data":[...]}, which Postgres
    // cannot cast to bytea. PostgREST's actual wire format is "\x<hex>".
    const envelope = encryptCredentials(JSON.stringify({ apiKey: "x" }), masterKey);
    const row = envelopeToRow(envelope);
    for (const value of Object.values(row)) {
      expect(typeof value).toBe("string");
      expect(value).toMatch(/^\\x[0-9a-f]*$/);
    }
  });

  it("round-trips through the exact string shape PostgREST returns from a SELECT", () => {
    const secret = JSON.stringify({ apiKey: "from-postgrest" });
    const envelope = encryptCredentials(secret, masterKey);
    const row = envelopeToRow(envelope);
    // Simulate what comes back over HTTP: plain strings, not Buffers —
    // JSON.parse(JSON.stringify(...)) makes that explicit rather than
    // relying on `row` already being string-typed.
    const asIfFromHttp = JSON.parse(JSON.stringify(row));
    const restored = rowToEnvelope(asIfFromHttp);
    expect(decryptCredentials(restored, masterKey)).toBe(secret);
  });
});
