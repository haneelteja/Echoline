import type { PostgrestError } from "@supabase/supabase-js";
import type { FastifyReply } from "fastify";

/**
 * Maps a Postgres/PostgREST error to an HTTP response, turning RLS denials
 * into 403s. timestamp/requestId (via reply.request.id, so every one of
 * this function's ~85 call sites gets them for free without a signature
 * change) are additive — same reasoning as app.ts's setErrorHandler.
 */
export function sendDbError(reply: FastifyReply, error: PostgrestError): FastifyReply {
  const timestamp = new Date().toISOString();
  const requestId = reply.request.id;
  if (error.code === "42501") {
    return reply.code(403).send({ error: "forbidden", message: "You don't have write access to this project.", timestamp, requestId });
  }
  if (error.code === "23505") {
    return reply.code(409).send({ error: "conflict", message: error.message, timestamp, requestId });
  }
  return reply.code(400).send({ error: "db_error", message: error.message, timestamp, requestId });
}
