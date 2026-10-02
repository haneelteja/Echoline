import type { ConnectionTester } from "../types";

export const testBrevo: ConnectionTester = async (credentials) => {
  const apiKey = credentials.apiKey;
  if (!apiKey) return { ok: false, error: "apiKey is required" };
  const res = await fetch("https://api.brevo.com/v3/account", {
    headers: { "api-key": apiKey },
  });
  if (!res.ok) return { ok: false, error: `Brevo responded ${res.status}` };
  const data = (await res.json()) as { email?: string; companyName?: string };
  return { ok: true, accountLabel: data.email ?? data.companyName ?? "Brevo account" };
};
