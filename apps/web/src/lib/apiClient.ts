import { createClient } from "@/lib/supabase/client";

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

export async function apiFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const headers = new Headers(init.headers);
  if (session?.access_token) headers.set("Authorization", `Bearer ${session.access_token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => undefined);
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}
