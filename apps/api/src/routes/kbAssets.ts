import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { sendDbError } from "../errors.js";

const createInput = z.object({
  folderId: z.string().uuid().nullable().optional(),
  kind: z.enum(["image", "document"]),
  name: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().min(0),
  storagePath: z.string().min(1),
  url: z.string().url(),
});

/**
 * Knowledge base file assets (photos/documents selectable from the template
 * editor). The browser uploads bytes straight to Supabase Storage using its
 * own session — storage.objects RLS (0014_kb_assets.sql) enforces
 * can_write_project the same way table RLS does, so there's no need for this
 * API to proxy file bytes or mint signed upload URLs. This route only
 * records/reads the resulting row and, on delete, also removes the object
 * from storage so deleting an asset doesn't just orphan the file.
 */
export const kbAssetsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/projects/:id/kb/assets", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { data, error } = await req.supabase.from("kb_assets").select("*").eq("project_id", id).order("created_at", { ascending: false });
    if (error) return sendDbError(reply, error);
    return data;
  });

  app.post("/projects/:id/kb/assets", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = createInput.parse(req.body);

    const { data: project, error: projErr } = await req.supabase.from("projects").select("org_id").eq("id", id).maybeSingle();
    if (projErr) return sendDbError(reply, projErr);
    if (!project) return reply.code(404).send({ error: "not_found" });

    const { data, error } = await req.supabase
      .from("kb_assets")
      .insert({
        project_id: id,
        org_id: (project as { org_id: string }).org_id,
        folder_id: body.folderId ?? null,
        kind: body.kind,
        name: body.name,
        mime_type: body.mimeType,
        size_bytes: body.sizeBytes,
        storage_path: body.storagePath,
        url: body.url,
      })
      .select()
      .single();
    if (error) return sendDbError(reply, error);
    return reply.code(201).send(data);
  });

  app.delete("/projects/:projectId/kb/assets/:assetId", async (req, reply) => {
    const { projectId, assetId } = req.params as { projectId: string; assetId: string };
    const { data: asset, error: fetchErr } = await req.supabase
      .from("kb_assets")
      .select("storage_path")
      .eq("project_id", projectId)
      .eq("id", assetId)
      .maybeSingle();
    if (fetchErr) return sendDbError(reply, fetchErr);
    if (!asset) return reply.code(404).send({ error: "not_found" });

    const { error: deleteErr } = await req.supabase.from("kb_assets").delete().eq("project_id", projectId).eq("id", assetId);
    if (deleteErr) return sendDbError(reply, deleteErr);

    // Best-effort — the row is already gone (the thing the UI/picker actually
    // cares about); a storage cleanup failure here shouldn't surface as a
    // user-facing error for what already succeeded.
    await req.supabase.storage.from("kb-assets").remove([(asset as { storage_path: string }).storage_path]).catch(() => {});

    return reply.code(204).send();
  });
};
