import type { ConnectionTester, EmailSender } from "../types";

export const testResend: ConnectionTester = async (credentials) => {
  const apiKey = credentials.apiKey;
  if (!apiKey) return { ok: false, error: "apiKey is required" };
  // No dedicated "whoami" endpoint; /domains is a lightweight authenticated
  // call that 401s on a bad key without requiring any domain to be verified.
  const res = await fetch("https://api.resend.com/domains", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) return { ok: false, error: `Resend responded ${res.status}` };
  return { ok: true, accountLabel: "Resend account" };
};

export const sendResend: EmailSender = async (credentials, message) => {
  const apiKey = credentials.apiKey;
  if (!apiKey) throw new Error("apiKey is required");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: message.from,
      to: [message.to],
      subject: message.subject,
      html: message.html,
      text: message.text,
      headers: message.headers,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend send failed (${res.status}): ${body}`);
  }
  const data = (await res.json()) as { id?: string };
  return { providerMessageId: data.id ?? `resend-${Date.now()}` };
};
