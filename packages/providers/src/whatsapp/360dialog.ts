import type { ConnectionTester } from "../types";

// 360dialog's API surface (Partner API vs direct client key) varies by
// onboarding path. This checks the webhook config endpoint as a lightweight
// "is this key valid" probe — confirm against current 360dialog docs before
// relying on it for real account labels.
export const test360Dialog: ConnectionTester = async (credentials) => {
  const apiKey = credentials.apiKey;
  if (!apiKey) return { ok: false, error: "apiKey is required" };
  const res = await fetch("https://waba.360dialog.io/v1/configs/webhook", {
    headers: { "D360-API-KEY": apiKey },
  });
  if (!res.ok) return { ok: false, error: `360dialog responded ${res.status}` };
  return { ok: true, accountLabel: "360dialog WABA" };
};
