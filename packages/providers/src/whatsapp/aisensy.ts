import type { ConnectionTester } from "../types";

// AiSensy has no dedicated "whoami" endpoint in their public docs as of
// writing — API keys are normally validated implicitly on first send. This
// probes their campaign endpoint with an intentionally-bogus campaign name:
// an auth failure (401/403) means the key is bad; any other response means
// the key itself was accepted. Confirm against current AiSensy docs before
// relying on this for production account-label display.
export const testAiSensy: ConnectionTester = async (credentials) => {
  const apiKey = credentials.apiKey;
  if (!apiKey) return { ok: false, error: "apiKey is required" };
  const res = await fetch("https://backend.aisensy.com/campaign/t1/api/v2", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey, campaignName: "__echoline_connection_test__" }),
  });
  if (res.status === 401 || res.status === 403) return { ok: false, error: "Invalid API key" };
  return { ok: true, accountLabel: "AiSensy account" };
};
