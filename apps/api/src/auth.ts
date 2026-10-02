import type { FastifyRequest, FastifyReply } from "fastify";
import { createAnonClient, createAdminClient } from "@echoline/db";

declare module "fastify" {
  interface FastifyRequest {
    supabase: ReturnType<typeof createAnonClient>;
    userId: string;
  }
}

/**
 * Validates the caller's Supabase access token and attaches a request-scoped
 * Supabase client (same token) so every query downstream runs under RLS as
 * that user — RLS (packages/db/supabase/migrations/0002_rls.sql) is the
 * authoritative permission check; routes only add clearer error messages.
 *
 * Registered with `api.addHook(...)` directly (not `api.register(...)`) because
 * Fastify encapsulates plugins registered via `.register()` — a hook added
 * inside one would never reach its sibling route plugins.
 */
export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  if (!token) {
    return reply.code(401).send({ error: "missing_token" });
  }
  const admin = createAdminClient();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) {
    return reply.code(401).send({ error: "invalid_token" });
  }
  req.supabase = createAnonClient(token);
  req.userId = data.user.id;
}
