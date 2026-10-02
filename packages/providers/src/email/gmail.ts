import type { ConnectionTester, EmailSender } from "../types";
import { buildRawMime, toBase64Url } from "./mime";

export const testGmail: ConnectionTester = async (credentials) => {
  const accessToken = credentials.accessToken;
  if (!accessToken) return { ok: false, error: "accessToken is required" };
  const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return { ok: false, error: `Google responded ${res.status}` };
  const data = (await res.json()) as { email?: string };
  return { ok: true, accountLabel: data.email ?? "Google account" };
};

// Note: credentials.refreshToken is handled by the caller (the worker calls
// refreshGoogleToken and passes a fresh accessToken here) — this adapter only
// ever sees a short-lived access token, never persists one.
export const sendGmail: EmailSender = async (credentials, message) => {
  const accessToken = credentials.accessToken;
  if (!accessToken) throw new Error("accessToken is required");
  const raw = toBase64Url(buildRawMime(message));
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gmail send failed (${res.status}): ${body}`);
  }
  const data = (await res.json()) as { id?: string };
  return { providerMessageId: data.id ?? `gmail-${Date.now()}` };
};
