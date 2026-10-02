import type { ConnectionTester, EmailSender } from "../types";

export const testOutlook: ConnectionTester = async (credentials) => {
  const accessToken = credentials.accessToken;
  if (!accessToken) return { ok: false, error: "accessToken is required" };
  const res = await fetch("https://graph.microsoft.com/v1.0/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return { ok: false, error: `Microsoft Graph responded ${res.status}` };
  const data = (await res.json()) as { mail?: string; userPrincipalName?: string };
  return { ok: true, accountLabel: data.mail ?? data.userPrincipalName ?? "Microsoft account" };
};

async function graphFetch(accessToken: string, path: string, init: RequestInit) {
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", ...init.headers },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Microsoft Graph ${path} failed (${res.status}): ${body}`);
  }
  return res;
}

export const sendOutlook: EmailSender = async (credentials, message) => {
  const accessToken = credentials.accessToken;
  if (!accessToken) throw new Error("accessToken is required");

  // POST /me/sendMail returns 202 with no body, so it can't give us a
  // providerMessageId. Create a draft first, then send that specific message —
  // the Graph API returns the draft's id, which is what we actually track.
  const draftRes = await graphFetch(accessToken, "/me/messages", {
    method: "POST",
    body: JSON.stringify({
      subject: message.subject,
      body: { contentType: "HTML", content: message.html },
      toRecipients: [{ emailAddress: { address: message.to } }],
      internetMessageHeaders: Object.entries(message.headers ?? {}).map(([name, value]) => ({ name, value })),
    }),
  });
  const draft = (await draftRes.json()) as { id: string };

  await graphFetch(accessToken, `/me/messages/${draft.id}/send`, { method: "POST" });
  return { providerMessageId: draft.id };
};
