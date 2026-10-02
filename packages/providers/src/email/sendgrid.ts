import type { ConnectionTester } from "../types";

export const testSendGrid: ConnectionTester = async (credentials) => {
  const apiKey = credentials.apiKey;
  if (!apiKey) return { ok: false, error: "apiKey is required" };
  const res = await fetch("https://api.sendgrid.com/v3/user/email", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) return { ok: false, error: `SendGrid responded ${res.status}` };
  const data = (await res.json()) as { email?: string };
  return { ok: true, accountLabel: data.email ?? "SendGrid account" };
};
