import type { FastifyPluginAsync } from "fastify";
import { sendDbError } from "../errors.js";

/**
 * Resets every contact in a project back to its pre-outreach state, for
 * re-running a test campaign from scratch. Clears the fields the UI reads to
 * render "Not Contacted" / no invalid flag / no reply (see packages/core/src/status.ts
 * and apps/web's contacts page), and also deletes the project's `messages` rows —
 * without that, claim_message_send's unique (project_id, contact_id, channel, step)
 * constraint silently blocks the scheduler from re-sending steps it already sent,
 * even once em_stage/wa_stage are back at 0. message_events cascade-deletes with
 * messages, so one delete clears both.
 */
export const contactsResetRoutes: FastifyPluginAsync = async (app) => {
  app.post("/projects/:id/contacts/reset-status", async (req, reply) => {
    const { id } = req.params as { id: string };

    const { error: delErr } = await req.supabase.from("messages").delete().eq("project_id", id);
    if (delErr) return sendDbError(reply, delErr);

    const { data, error } = await req.supabase
      .from("contacts")
      .update({
        em_stage: 0,
        em_status: "not_contacted",
        em_last: null,
        em_track: null,
        em_manual_last: false,
        wa_stage: 0,
        wa_status: "not_contacted",
        wa_last: null,
        wa_track: null,
        wa_manual_last: false,
        sentiment: "Not Contacted",
      })
      .eq("project_id", id)
      .select("id");
    if (error) return sendDbError(reply, error);

    return { reset: data?.length ?? 0 };
  });
};
