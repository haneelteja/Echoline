import type { FastifyPluginAsync } from "fastify";
import { sendDbError } from "../errors.js";

interface CollectionConfig {
  path: string; // e.g. "contacts" -> /projects/:id/contacts
  table: string; // e.g. "contacts"
  orgScoped: boolean; // insert requires org_id (all of ours do)
}

/**
 * Generic list/create/update/delete routes for project-scoped tables that don't
 * need bespoke validation yet (contacts, templates, kb_items, lead_sources).
 * Column names are passed through as-is; apps/web maps camelCase <-> snake_case.
 */
function registerCollection(app: Parameters<FastifyPluginAsync>[0], cfg: CollectionConfig) {
  app.get(`/projects/:id/${cfg.path}`, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { data, error } = await req.supabase.from(cfg.table).select("*").eq("project_id", id);
    if (error) return sendDbError(reply, error);
    return data;
  });

  app.post(`/projects/:id/${cfg.path}`, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as Record<string, unknown>;
    // org_id is required by schema; resolve it from the project so callers don't have to pass it.
    const { data: project, error: projErr } = await req.supabase
      .from("projects")
      .select("org_id")
      .eq("id", id)
      .maybeSingle();
    if (projErr) return sendDbError(reply, projErr);
    if (!project) return reply.code(404).send({ error: "not_found" });
    const { data, error } = await req.supabase
      .from(cfg.table)
      .insert({ ...body, project_id: id, org_id: (project as any).org_id })
      .select()
      .single();
    if (error) return sendDbError(reply, error);
    return reply.code(201).send(data);
  });

  app.patch(`/projects/:projectId/${cfg.path}/:itemId`, async (req, reply) => {
    const { projectId, itemId } = req.params as { projectId: string; itemId: string };
    const body = req.body as Record<string, unknown>;
    const { data, error } = await req.supabase
      .from(cfg.table)
      .update(body)
      .eq("project_id", projectId)
      .eq("id", itemId)
      .select()
      .maybeSingle();
    if (error) return sendDbError(reply, error);
    if (!data) return reply.code(404).send({ error: "not_found" });
    return data;
  });

  app.delete(`/projects/:projectId/${cfg.path}/:itemId`, async (req, reply) => {
    const { projectId, itemId } = req.params as { projectId: string; itemId: string };
    const { error } = await req.supabase.from(cfg.table).delete().eq("project_id", projectId).eq("id", itemId);
    if (error) return sendDbError(reply, error);
    return reply.code(204).send();
  });
}

export const collectionRoutes: FastifyPluginAsync = async (app) => {
  registerCollection(app, { path: "contacts", table: "contacts", orgScoped: true });
  registerCollection(app, { path: "templates", table: "templates", orgScoped: true });
  registerCollection(app, { path: "kb", table: "kb_items", orgScoped: true });
  registerCollection(app, { path: "sources", table: "lead_sources", orgScoped: true });
};
