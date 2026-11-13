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
      .select("id, message_id, contact_id, channel, event_type, payload, occurred_at, contacts(name, email, phone, raw_email, raw_phone)")
      .eq("project_id", id)
      .order("occurred_at", { ascending: false })
      .limit(PAGE_SIZE);
    if (before) query = query.lt("occurred_at", before);

    const { data, error } = await query;
    if (error) return sendDbError(reply, error);
    return data;
  });

  /**
   * Unbounded (well, 5000-capped) variant for the Reports tab's "Emails
   * sent"/"WhatsApp sent" tabs — those need the full set to filter/sort/
   * export client-side, unlike the Activity log's cursor-paginated feed.
   * `event_type=sent` only: a report of what went out, not every delivery/
   * open/bounce event layered on top. Includes area/source so the Reports
   * page's existing area/source filters work against this data too.
   */
  app.get("/projects/:id/activity/sent", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { data, error } = await req.supabase
      .from("message_events")
      .select("id, message_id, contact_id, channel, event_type, payload, occurred_at, contacts(name, email, phone, area, source, raw_email, raw_phone)")
      .eq("project_id", id)
      .eq("event_type", "sent")
      .order("occurred_at", { ascending: false })
      .limit(5000);
    if (error) return sendDbError(reply, error);
    return data;
  });
};
