import type { ConnectionTester } from "../types";

export const testMeta: ConnectionTester = async (credentials) => {
  const { accessToken, phoneNumberId } = credentials;
  if (!accessToken || !phoneNumberId) return { ok: false, error: "accessToken and phoneNumberId are required" };
  const url = `https://graph.facebook.com/v19.0/${phoneNumberId}?fields=verified_name,display_phone_number&access_token=${encodeURIComponent(accessToken)}`;
  const res = await fetch(url);
  if (!res.ok) return { ok: false, error: `Meta Graph API responded ${res.status}` };
  const data = (await res.json()) as { display_phone_number?: string; verified_name?: string };
  return { ok: true, accountLabel: data.display_phone_number ?? data.verified_name ?? "WhatsApp number" };
};
