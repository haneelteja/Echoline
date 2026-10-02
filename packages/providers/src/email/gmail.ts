import type { ConnectionTester } from "../types";

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
