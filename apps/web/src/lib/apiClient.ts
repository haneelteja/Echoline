import { createClient } from "@/lib/supabase/client";
import { logError } from "@/lib/logger";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown) {
    super(typeof body === "object" && body && "message" in body ? String((body as { message?: unknown }).message) : `API error ${status}`);
    this.status = status;
    this.body = body;
  }
}

/** Distinct from ApiError: thrown when fetch() itself never got a response
 * (DNS failure, offline, CORS, a Render cold-start that times out before
 * any bytes arrive) — there's no status/body to report, which is itself
 * useful information, not a degraded ApiError. */
export class NetworkError extends Error {}

function safeJsonParse(text: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(text);
    return typeof parsed === "object" && parsed ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export async function apiFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const headers = new Headers(init.headers);
  if (session?.access_token) headers.set("Authorization", `Bearer ${session.access_token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const endpoint = `${init.method ?? "GET"} ${path}`;
  let res: Response;
  try {
    // Explicit no-store: without it, a GET's `cache` mode defaults to the
    // browser's own heuristics, which can serve a stale cached response for a
    // URL it already fetched — invisible normally, but exactly the kind of
    // thing that would make a refetch right after a mutation (e.g. Reset
    // status's refreshProjectData()) silently show pre-mutation data.
    res = await fetch(`${API_URL}${path}`, { ...init, headers, cache: "no-store" });
  } catch (err) {
    logError({ source: "network", module: "apiClient.apiFetch", endpoint, message: "Network request failed", error: err });
    throw new NetworkError("Unable to reach the server. Check your connection and try again.");
  }

  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => undefined);
  if (!res.ok) {
    const apiErr = new ApiError(res.status, body);
    logError({
      source: "api",
      module: "apiClient.apiFetch",
      endpoint,
      status: res.status,
      message: apiErr.message,
      error: apiErr,
      // Best-effort only — logging a failed request must never itself throw
      // and mask the real ApiError being raised below.
      params: typeof init.body === "string" ? safeJsonParse(init.body) : undefined,
    });
    throw apiErr;
  }
  return body as T;
}
