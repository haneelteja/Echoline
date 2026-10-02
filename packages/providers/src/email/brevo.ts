import type { ConnectionTester, EmailSender } from "../types";

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

export const sendBrevo: EmailSender = async (credentials, message) => {
  const apiKey = credentials.apiKey;
  if (!apiKey) throw new Error("apiKey is required");
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      sender: { email: message.from },
      to: [{ email: message.to }],
      subject: message.subject,
      htmlContent: message.html,
      textContent: message.text,
      headers: message.headers,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Brevo send failed (${res.status}): ${body}`);
  }
  const data = (await res.json()) as { messageId?: string };
  return { providerMessageId: data.messageId ?? `brevo-${Date.now()}` };
};
