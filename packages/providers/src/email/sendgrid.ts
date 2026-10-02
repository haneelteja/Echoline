import type { ConnectionTester, EmailSender } from "../types";

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

export const sendSendGrid: EmailSender = async (credentials, message) => {
  const apiKey = credentials.apiKey;
  if (!apiKey) throw new Error("apiKey is required");
  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: message.to }], headers: message.headers }],
      from: { email: message.from },
      subject: message.subject,
      content: [
        { type: "text/plain", value: message.text },
        { type: "text/html", value: message.html },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`SendGrid send failed (${res.status}): ${body}`);
  }
  // SendGrid's v3/mail/send returns 202 with no body; the message ID comes
  // back in the X-Message-Id response header.
  const providerMessageId = res.headers.get("x-message-id") ?? `sendgrid-${Date.now()}`;
  return { providerMessageId };
};
