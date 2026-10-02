import type { ConnectionTester } from "../types";

export const testTwilio: ConnectionTester = async (credentials) => {
  const { accountSid, authToken } = credentials;
  if (!accountSid || !authToken) return { ok: false, error: "accountSid and authToken are required" };
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}.json`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!res.ok) return { ok: false, error: `Twilio responded ${res.status}` };
  const data = (await res.json()) as { friendly_name?: string };
  return { ok: true, accountLabel: data.friendly_name ?? "Twilio account" };
};
