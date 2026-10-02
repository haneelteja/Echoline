import type { PostgrestError } from "@supabase/supabase-js";
import type { FastifyReply } from "fastify";

/** Maps a Postgres/PostgREST error to an HTTP response, turning RLS denials into 403s. */
export function sendDbError(reply: FastifyReply, error: PostgrestError): FastifyReply {
  if (error.code === "42501") {
    return reply.code(403).send({ error: "forbidden", message: "You don't have write access to this project." });
  }
  if (error.code === "23505") {
    return reply.code(409).send({ error: "conflict", message: error.message });
  }
  return reply.code(400).send({ error: "db_error", message: error.message });
}
