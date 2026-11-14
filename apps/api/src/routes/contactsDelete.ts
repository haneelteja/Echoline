import type { FastifyPluginAsync } from "fastify";
import type { PostgrestError } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
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
 * Snapshots every contact about to be deleted — plus its messages,
 * message_events, and lead_status_log, all of which would otherwise
 * cascade-delete with it (see 0001_init.sql/0012's on-delete-cascade FKs) —
 * into deleted_contacts/deleted_messages/deleted_message_events/
 * deleted_lead_status_log, then deletes the contacts. Snapshot happens
 * first so a failed snapshot blocks the delete rather than the delete
 * racing ahead of its own audit trail.
 *
 * IDs for the new rows are generated client-side (not left to each table's
 * default) so the contact_id -> deleted_contact_id and message_id ->
 * deleted_message_id mappings are known immediately, without a round trip
 * per insert to read generated ids back — this is one query per table,
 * not one per contact, so it stays cheap even for a 189-row bulk delete.
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
  const contactIds = found.map((c) => c.id);

  const contactIdToSnapshotId = new Map(found.map((c) => [c.id, randomUUID()]));
  const contactSnapshots = found.map((c) => ({
    id: contactIdToSnapshotId.get(c.id),
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
  const { error: contactSnapErr } = await supabase.from("deleted_contacts").insert(contactSnapshots);
  if (contactSnapErr) return { error: contactSnapErr, deletedCount: 0 };

  const { data: messages, error: msgErr } = await supabase
    .from("messages")
    .select("id, org_id, project_id, contact_id, channel, step, provider_connection_id, provider_message_id, status, queued_at, sent_at, updated_at")
    .eq("project_id", projectId)
    .in("contact_id", contactIds);
  if (msgErr) return { error: msgErr, deletedCount: 0 };
  const msgRows = (messages ?? []) as any[];
  const messageIdToSnapshotId = new Map(msgRows.map((m) => [m.id, randomUUID()]));
  if (msgRows.length) {
    const { error: msgSnapErr } = await supabase.from("deleted_messages").insert(
      msgRows.map((m) => ({
        id: messageIdToSnapshotId.get(m.id),
        org_id: m.org_id,
        project_id: m.project_id,
        deleted_contact_id: contactIdToSnapshotId.get(m.contact_id),
        channel: m.channel,
        step: m.step,
        provider_connection_id: m.provider_connection_id,
        provider_message_id: m.provider_message_id,
        status: m.status,
        queued_at: m.queued_at,
        sent_at: m.sent_at,
        updated_at: m.updated_at,
      }))
    );
    if (msgSnapErr) return { error: msgSnapErr, deletedCount: 0 };
  }

  const { data: events, error: evErr } = await supabase
    .from("message_events")
    .select("org_id, project_id, message_id, contact_id, channel, event_type, payload, occurred_at")
    .eq("project_id", projectId)
    .in("contact_id", contactIds);
  if (evErr) return { error: evErr, deletedCount: 0 };
  const evRows = (events ?? []) as any[];
  if (evRows.length) {
    const { error: evSnapErr } = await supabase.from("deleted_message_events").insert(
      evRows.map((e) => ({
        org_id: e.org_id,
        project_id: e.project_id,
        deleted_contact_id: contactIdToSnapshotId.get(e.contact_id),
        deleted_message_id: e.message_id ? messageIdToSnapshotId.get(e.message_id) ?? null : null,
        channel: e.channel,
        event_type: e.event_type,
        payload: e.payload,
        occurred_at: e.occurred_at,
      }))
    );
    if (evSnapErr) return { error: evSnapErr, deletedCount: 0 };
  }

  const { data: statusLogs, error: slErr } = await supabase
    .from("lead_status_log")
    .select("org_id, project_id, contact_id, status, follow_up_date, created_at")
    .eq("project_id", projectId)
    .in("contact_id", contactIds);
  if (slErr) return { error: slErr, deletedCount: 0 };
  const slRows = (statusLogs ?? []) as any[];
  if (slRows.length) {
    const { error: slSnapErr } = await supabase.from("deleted_lead_status_log").insert(
      slRows.map((s) => ({
        org_id: s.org_id,
        project_id: s.project_id,
        deleted_contact_id: contactIdToSnapshotId.get(s.contact_id),
        status: s.status,
        follow_up_date: s.follow_up_date,
        original_created_at: s.created_at,
      }))
    );
    if (slSnapErr) return { error: slSnapErr, deletedCount: 0 };
  }

  const { error: delErr } = await supabase.from("contacts").delete().eq("project_id", projectId).in("id", contactIds);
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
