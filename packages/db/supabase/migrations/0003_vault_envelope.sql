-- Phase 2: proper envelope encryption for provider_connections.
-- Each credential is encrypted with its own random Data Encryption Key (DEK);
-- the DEK itself is encrypted with the master key (env/KMS) and stored alongside.
-- Losing/rotating the master key only requires re-wrapping DEKs, not re-encrypting
-- every credential from scratch.

alter table provider_connections
  add column encrypted_dek bytea,
  add column dek_iv bytea,
  add column dek_tag bytea;
