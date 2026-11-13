import type { FastifyPluginAsync } from "fastify";
import type { PostgrestError } from "@supabase/supabase-js";
import { sendDbError } from "../errors.js";

interface TemplateContentRow {
  id: string;
  org_id: string;
  project_id: string;
  name: string | null;
  subject: string | null;
  body: string | null;
  category_lines: Record<string, unknown>;
  header_asset_id: string | null;
  gallery_asset_ids: string[];
  cc_email: string | null;
  reply_to_email: string | null;
  body_is_html: boolean;
  from_connection_id: string | null;
  from_email: string | null;
}

/** The editable-content subset of a template row, snapshotted into
 * template_versions every time it changes (save or revert) — everything
 * else on the templates row (channel, step, meta_status, ai, is_library) is
 * slot/approval metadata, not "content" worth versioning. */
function contentFields(t: TemplateContentRow) {
  return {
    name: t.name,
    subject: t.subject,
    body: t.body,
    category_lines: t.category_lines,
    header_asset_id: t.header_asset_id,
    gallery_asset_ids: t.gallery_asset_ids,
    cc_email: t.cc_email,
    reply_to_email: t.reply_to_email,
    body_is_html: t.body_is_html,
    from_connection_id: t.from_connection_id,
    from_email: t.from_email,
  };
}

/**
 * Updates a template's content fields and snapshots the resulting row into
 * template_versions in the same request — used by both the normal
 * save (PATCH) and revert-to-a-past-version paths below, so every settled
 * content change gets a version entry, including the revert itself. History
 * is append-only: nothing here ever edits or deletes an existing version.
 */
async function updateAndSnapshot(
  supabase: any,
  projectId: string,
  itemId: string,
  patch: Record<string, unknown>
): Promise<{ data: TemplateContentRow | null; error: PostgrestError | null }> {
  const { data, error } = await supabase.from("templates").update(patch).eq("project_id", projectId).eq("id", itemId).select().maybeSingle();
  if (error || !data) return { data: null, error };
  const row = data as TemplateContentRow;
  const { error: versionErr } = await supabase.from("template_versions").insert({
    template_id: row.id,
    org_id: row.org_id,
    project_id: row.project_id,
    ...contentFields(row),
  });
  if (versionErr) return { data: null, error: versionErr };
  return { data: row, error: null };
}

export const templateVersionsRoutes: FastifyPluginAsync = async (app) => {
  // Replaces the generic collections.ts PATCH for templates (see
  // collections.ts's skipPatch) so every save snapshots a version.
  app.patch("/projects/:projectId/templates/:itemId", async (req, reply) => {
    const { projectId, itemId } = req.params as { projectId: string; itemId: string };
    const body = req.body as Record<string, unknown>;
    const { data, error } = await updateAndSnapshot(req.supabase, projectId, itemId, body);
    if (error) return sendDbError(reply, error);
    if (!data) return reply.code(404).send({ error: "not_found" });
    return data;
  });

  app.get("/projects/:projectId/templates/:itemId/versions", async (req, reply) => {
    const { projectId, itemId } = req.params as { projectId: string; itemId: string };
    const { data, error } = await req.supabase
      .from("template_versions")
      .select("*")
      .eq("project_id", projectId)
      .eq("template_id", itemId)
      .order("created_at", { ascending: false });
    if (error) return sendDbError(reply, error);
    return data;
  });

  app.post("/projects/:projectId/templates/:itemId/versions/:versionId/revert", async (req, reply) => {
    const { projectId, itemId, versionId } = req.params as { projectId: string; itemId: string; versionId: string };
    const { data: version, error: versionErr } = await req.supabase
      .from("template_versions")
      .select("*")
      .eq("project_id", projectId)
      .eq("template_id", itemId)
      .eq("id", versionId)
      .maybeSingle();
    if (versionErr) return sendDbError(reply, versionErr);
    if (!version) return reply.code(404).send({ error: "not_found" });

    const { data, error } = await updateAndSnapshot(req.supabase, projectId, itemId, contentFields(version as TemplateContentRow));
    if (error) return sendDbError(reply, error);
    if (!data) return reply.code(404).send({ error: "not_found" });
    return data;
  });
};
