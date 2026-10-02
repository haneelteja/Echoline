import type { ConnectionTester } from "../types";

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
