import type { ConnectionTester } from "../types";

export const testGupshup: ConnectionTester = async (credentials) => {
  const { apiKey, appId } = credentials;
  if (!apiKey || !appId) return { ok: false, error: "apiKey and appId are required" };
  const res = await fetch(`https://api.gupshup.io/sm/api/v1/app/${appId}`, {
    headers: { apikey: apiKey },
  });
  if (!res.ok) return { ok: false, error: `Gupshup responded ${res.status}` };
  const data = (await res.json()) as { name?: string };
  return { ok: true, accountLabel: data.name ?? "Gupshup app" };
};
