import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { sendDbError } from "../errors.js";

const addEntryInput = z.object({
  status: z.string().trim().min(1),
  followUpDate: z.string().date().optional().nullable(),
});

/**
 * Per-lead status history — a growing, dated log of manual updates (distinct
 * from message_events, which tracks sends/deliveries). Append-only: no PATCH/
 * DELETE, same convention as message_events.
 */
export const statusLogRoutes: FastifyPluginAsync = async (app) => {
  // Project-wide listing — lets the Leads table show each contact's latest
  // entry in one request instead of N+1 per-row fetches.
  app.get("/projects/:projectId/status-log", async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const { data, error } = await req.supabase
      .from("lead_status_log")
      .select("id, contact_id, status, follow_up_date, created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });
    if (error) return sendDbError(reply, error);
    return data;
  });

  app.get("/projects/:projectId/contacts/:contactId/status-log", async (req, reply) => {
    const { projectId, contactId } = req.params as { projectId: string; contactId: string };
    const { data, error } = await req.supabase
      .from("lead_status_log")
      .select("id, contact_id, status, follow_up_date, created_at")
      .eq("project_id", projectId)
      .eq("contact_id", contactId)
      .order("created_at", { ascending: false });
    if (error) return sendDbError(reply, error);
    return data;
  });

  app.post("/projects/:projectId/contacts/:contactId/status-log", async (req, reply) => {
    const { projectId, contactId } = req.params as { projectId: string; contactId: string };
    const body = addEntryInput.parse(req.body);

    const { data: project, error: projErr } = await req.supabase.from("projects").select("org_id").eq("id", projectId).maybeSingle();
    if (projErr) return sendDbError(reply, projErr);
    if (!project) return reply.code(404).send({ error: "not_found" });

    const { data, error } = await req.supabase
      .from("lead_status_log")
      .insert({
        org_id: (project as { org_id: string }).org_id,
        project_id: projectId,
        contact_id: contactId,
        status: body.status,
        follow_up_date: body.followUpDate ?? null,
      })
      .select("id, contact_id, status, follow_up_date, created_at")
      .single();
    if (error) return sendDbError(reply, error);
    return reply.code(201).send(data);
  });
};
