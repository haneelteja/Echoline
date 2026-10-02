import type { ConnectionTester } from "../types";

// Interakt's public REST surface for a plain "whoami" check is thin as of
// writing — this calls their organization endpoint as a credential probe.
// Confirm the exact path against current Interakt docs before production use.
export const testInterakt: ConnectionTester = async (credentials) => {
  const apiKey = credentials.apiKey;
  if (!apiKey) return { ok: false, error: "apiKey is required" };
  const res = await fetch("https://api.interakt.ai/v1/organizations/me", {
    headers: { Authorization: `Basic ${apiKey}` },
  });
  if (!res.ok) return { ok: false, error: `Interakt responded ${res.status}` };
  const data = (await res.json()) as { name?: string };
  return { ok: true, accountLabel: data.name ?? "Interakt account" };
};
