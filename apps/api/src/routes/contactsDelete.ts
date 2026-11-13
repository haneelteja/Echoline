import type { FastifyPluginAsync } from "fastify";
import type { PostgrestError } from "@supabase/supabase-js";
import { sendDbError } from "../errors.js";

interface ContactSnapshotRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  category: string | null;
  area: string | null;
  source: string | null;
  external_id: string | null;
  raw_email: string | null;
  raw_phone: string | null;
  em_status: string;
  wa_status: string;
  created_at: string;
}

/**
 * Snapshots every contact about to be deleted into deleted_contacts, then
 * deletes them — in that order, so a failed snapshot blocks the delete
 * rather than the delete racing ahead of its own audit trail. Shared by the
 * single-item and bulk routes below, since bulk is just "single with more
 * ids" once id-list handling is factored out.
 */
async function deleteContactsWithAudit(
  supabase: any,
  orgId: string,
  projectId: string,
  deletedBy: string | undefined,
  ids: string[]
): Promise<{ error: PostgrestError | null; deletedCount: number }> {
  const { data: rows, error: fetchErr } = await supabase
    .from("contacts")
    .select("id, name, email, phone, category, area, source, external_id, raw_email, raw_phone, em_status, wa_status, created_at")
    .eq("project_id", projectId)
    .in("id", ids);
  if (fetchErr) return { error: fetchErr, deletedCount: 0 };
  const found = (rows ?? []) as ContactSnapshotRow[];
  if (!found.length) return { error: null, deletedCount: 0 };

  const snapshots = found.map((c) => ({
    org_id: orgId,
    project_id: projectId,
    original_contact_id: c.id,
    name: c.name,
    email: c.email,
    phone: c.phone,
    category: c.category,
    area: c.area,
    source: c.source,
    external_id: c.external_id,
    raw_email: c.raw_email,
    raw_phone: c.raw_phone,
    em_status: c.em_status,
    wa_status: c.wa_status,
    original_created_at: c.created_at,
    deleted_by: deletedBy ?? null,
  }));
  const { error: snapErr } = await supabase.from("deleted_contacts").insert(snapshots);
  if (snapErr) return { error: snapErr, deletedCount: 0 };

  const { error: delErr } = await supabase
    .from("contacts")
    .delete()
    .eq("project_id", projectId)
    .in(
      "id",
      found.map((c) => c.id)
    );
  if (delErr) return { error: delErr, deletedCount: 0 };
  return { error: null, deletedCount: found.length };
}

async function resolveOrgId(supabase: any, projectId: string): Promise<{ orgId: string | null; error: PostgrestError | null }> {
  const { data: project, error } = await supabase.from("projects").select("org_id").eq("id", projectId).maybeSingle();
  if (error) return { orgId: null, error };
  return { orgId: project ? (project as { org_id: string }).org_id : null, error: null };
}

/**
 * Replaces collections.ts's generic contacts DELETE routes (see
 * collections.ts's skipDelete) so every deletion leaves a permanent record
 * in deleted_contacts first — contacts is otherwise a true hard delete that
 * cascades away messages/message_events/lead_status_log with it, leaving no
 * trace a lead was ever received.
 */
export const contactsDeleteRoutes: FastifyPluginAsync = async (app) => {
  app.delete("/projects/:projectId/contacts/:itemId", async (req, reply) => {
    const { projectId, itemId } = req.params as { projectId: string; itemId: string };
    const { orgId, error: orgErr } = await resolveOrgId(req.supabase, projectId);
    if (orgErr) return sendDbError(reply, orgErr);
    if (!orgId) return reply.code(404).send({ error: "not_found" });

    const { error, deletedCount } = await deleteContactsWithAudit(req.supabase, orgId, projectId, req.userEmail, [itemId]);
    if (error) return sendDbError(reply, error);
    if (!deletedCount) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });

  app.delete("/projects/:id/contacts", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { ids } = req.body as { ids?: unknown };
    if (!Array.isArray(ids) || ids.length === 0 || !ids.every((v) => typeof v === "string")) {
      return reply.code(400).send({ error: "ids_required", message: "Body must be { ids: string[] }" });
    }
    const { orgId, error: orgErr } = await resolveOrgId(req.supabase, id);
    if (orgErr) return sendDbError(reply, orgErr);
    if (!orgId) return reply.code(404).send({ error: "not_found" });

    const { error } = await deleteContactsWithAudit(req.supabase, orgId, id, req.userEmail, ids as string[]);
    if (error) return sendDbError(reply, error);
    return reply.code(204).send();
  });

  // Browsable audit trail for the Contacts page's "Deleted leads" dialog.
  app.get("/projects/:id/contacts/deleted", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { data, error } = await req.supabase
      .from("deleted_contacts")
      .select("*")
      .eq("project_id", id)
      .order("deleted_at", { ascending: false })
      .limit(2000);
    if (error) return sendDbError(reply, error);
    return data;
  });
};
