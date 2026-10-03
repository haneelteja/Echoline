import type { FastifyPluginAsync } from "fastify";
import { sendDbError } from "../errors.js";

const PAGE_SIZE = 100;

/**
 * Read-only on purpose: message_events has no update/delete RLS policy
 * (migration 0002) and isn't in collections.ts's generic CRUD list, since
 * nothing should be hand-editing an append-only event log. `before` is an
 * occurred_at cursor for "load older" pagination — plain offset pagination
 * would skip/repeat rows as new events keep landing at the top.
 */
export const activityRoutes: FastifyPluginAsync = async (app) => {
  app.get("/projects/:id/activity", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { before } = req.query as { before?: string };

    let query = req.supabase
      .from("message_events")
      .select("id, message_id, contact_id, channel, event_type, payload, occurred_at, contacts(name)")
      .eq("project_id", id)
      .order("occurred_at", { ascending: false })
      .limit(PAGE_SIZE);
    if (before) query = query.lt("occurred_at", before);

    const { data, error } = await query;
    if (error) return sendDbError(reply, error);
    return data;
  });
};
