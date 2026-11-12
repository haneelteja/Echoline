type ErrorSource = "api" | "network" | "component" | "runtime";

interface LogErrorInput {
  source: ErrorSource;
  module: string; // e.g. "apiClient.apiFetch", "TeamSettings.sendInvite"
  message: string;
  error?: unknown; // original thrown value, for the stack
  endpoint?: string; // "POST /v1/orgs/:orgId/invites"
  status?: number;
  params?: Record<string, unknown>; // already-sanitized, never raw credentials/tokens
}

const SENSITIVE_KEYS = new Set(["password", "token", "accesstoken", "credentials", "apikey", "secret"]);

/** Shallow redaction — good enough for the request-params objects this app
 * actually sends (flat JSON bodies), not a general-purpose deep sanitizer. */
function sanitize(params?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!params) return undefined;
  return Object.fromEntries(Object.entries(params).map(([k, v]) => [k, SENSITIVE_KEYS.has(k.toLowerCase()) ? "[redacted]" : v]));
}

/**
 * Single chokepoint for every error this app logs to the console — so
 * "search the console for [Echoline]" always works, regardless of which
 * page or service produced the error. Never throws itself; logging a
 * failure must never become a second failure.
 */
export function logError(input: LogErrorInput): void {
  try {
    const timestamp = new Date().toISOString();
    const stack = input.error instanceof Error ? input.error.stack : undefined;
    console.error(
      `[Echoline] ${timestamp}\n` +
        `  source:    ${input.source}\n` +
        `  module:    ${input.module}\n` +
        (input.endpoint ? `  endpoint:  ${input.endpoint}\n` : "") +
        (input.status != null ? `  status:    ${input.status}\n` : "") +
        `  message:   ${input.message}\n` +
        (input.params ? `  params:    ${JSON.stringify(sanitize(input.params))}\n` : "") +
        (stack ? `  stack:     ${stack}` : "")
    );
  } catch {
    // never let the logger itself throw
  }
}
