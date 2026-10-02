import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { sendDbError } from "../errors.js";
import { getSchedulerQueue } from "../schedulerQueue.js";

const projectInput = z.object({
  name: z.string().min(1),
  brand: z.string().optional(),
  senderName: z.string().optional(),
  website: z.string().optional(),
  waNumber: z.string().optional(),
  accent: z.string().optional(),
});

export const projectRoutes: FastifyPluginAsync = async (app) => {
  // List projects visible to the caller. For owner/admin/operator/viewer this is
  // every project in their orgs; for client_viewer, RLS narrows it to
  // project_client_access. Powers the project switcher.
  app.get("/projects", async (req, reply) => {
    const { data, error } = await req.supabase.from("projects").select("*").order("created_at");
    if (error) return sendDbError(reply, error);
    return data;
  });

  app.get("/projects/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { data, error } = await req.supabase.from("projects").select("*").eq("id", id).maybeSingle();
    if (error) return sendDbError(reply, error);
    if (!data) return reply.code(404).send({ error: "not_found" });
    return data;
  });

  app.post("/orgs/:orgId/projects", async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const body = projectInput.parse(req.body);
    const { data, error } = await req.supabase
      .from("projects")
      .insert({
        org_id: orgId,
        name: body.name,
        brand: body.brand ?? null,
        sender_name: body.senderName ?? null,
        website: body.website ?? null,
        wa_number: body.waNumber ?? null,
        accent: body.accent ?? null,
      })
      .select()
      .single();
    if (error) return sendDbError(reply, error);
    // every new project needs its 1:1 settings rows before the UI can render
    await req.supabase.from("sequence_settings").insert({ project_id: data.id });
    await req.supabase.from("channel_settings").insert({ project_id: data.id });
    await req.supabase.from("brand_kb").insert({ project_id: data.id });
    return reply.code(201).send(data);
  });

  app.patch("/projects/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = projectInput.partial().parse(req.body);
    const update: Record<string, unknown> = {};
    if (body.name !== undefined) update.name = body.name;
    if (body.brand !== undefined) update.brand = body.brand;
    if (body.senderName !== undefined) update.sender_name = body.senderName;
    if (body.website !== undefined) update.website = body.website;
    if (body.waNumber !== undefined) update.wa_number = body.waNumber;
    if (body.accent !== undefined) update.accent = body.accent;
    const { data, error } = await req.supabase.from("projects").update(update).eq("id", id).select().maybeSingle();
    if (error) return sendDbError(reply, error);
    if (!data) return reply.code(404).send({ error: "not_found" });
    return data;
  });

  // Manual "Run due steps now" — operator and above. Enqueues onto the same
  // scheduler queue apps/worker's repeatable 5-minute tick uses; the worker
  // does the actual work, this just triggers it immediately instead of
  // waiting for the next tick.
  app.post("/projects/:id/run-due", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { data: project, error: projErr } = await req.supabase.from("projects").select("org_id").eq("id", id).maybeSingle();
    if (projErr) return sendDbError(reply, projErr);
    if (!project) return reply.code(404).send({ error: "not_found" });

    const { data: membership, error: memErr } = await req.supabase
      .from("memberships")
      .select("role")
      .eq("org_id", (project as any).org_id)
      .eq("user_id", req.userId)
      .maybeSingle();
    if (memErr) return sendDbError(reply, memErr);
    if (!membership || !["owner", "admin", "operator"].includes((membership as any).role)) {
      return reply.code(403).send({ error: "forbidden", message: "Operator access or above is required to run due steps." });
    }

    await getSchedulerQueue().add("manual-run-due", { projectId: id }, { removeOnComplete: 100, removeOnFail: 100 });
    return { ok: true };
  });
};
