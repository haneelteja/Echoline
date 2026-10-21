import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { createAdminClient } from "@echoline/db";
import { sendDbError } from "../errors.js";

const createOrgInput = z.object({ name: z.string().min(1) });

// Everyone except 'owner' — the org/project creator stays owner, unchanged;
// everyone invited in afterward is admin/viewer/project_viewer. Admin is the
// practical "co-owner" (full org-management rights via can_admin_org), not a
// separate role — see docs/ROADMAP.md for why no new role was added. The
// former 'operator' tier was removed entirely (see docs/ROADMAP.md) —
// write access and admin access are no longer distinct tiers.
const INVITABLE_ROLES = ["admin", "viewer", "project_viewer"] as const;
const updateMemberInput = z.object({ role: z.enum(INVITABLE_ROLES) });

export const orgRoutes: FastifyPluginAsync = async (app) => {
  // Self-serve org creation — the entry point for a brand-new signup with
  // zero orgs, or an existing user starting a fully separate organization.
  // There's deliberately no RLS insert policy on `organizations` (an org
  // can't satisfy can_admin_org before it has an owner — chicken and egg),
  // so this is the one legitimate place that bootstraps both the org and its
  // first membership via the admin client, outside the caller's own RLS.
  app.post("/orgs", async (req, reply) => {
    const body = createOrgInput.parse(req.body);
    const db = createAdminClient();
    const { data: org, error } = await db.from("organizations").insert({ name: body.name }).select().single();
    if (error) return sendDbError(reply, error);
    const { error: memErr } = await db.from("memberships").insert({ org_id: (org as any).id, user_id: req.userId, role: "owner" });
    if (memErr) return sendDbError(reply, memErr);
    return reply.code(201).send(org);
  });

  // Member list, with each row's email resolved via the admin client —
  // auth.users isn't exposed to a regular PostgREST client at all, so every
  // caller needs this regardless of their own role. Relies on `memberships`
  // RLS (can_admin_org) for the actual authorization: a non-admin caller's
  // own select here returns zero rows, not an error, so they see an empty list.
  app.get("/orgs/:orgId/members", async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const { data: memberships, error } = await req.supabase.from("memberships").select("*").eq("org_id", orgId).order("created_at");
    if (error) return sendDbError(reply, error);
    const db = createAdminClient();
    const rows = await Promise.all(
      ((memberships as any[]) ?? []).map(async (m) => {
        const { data } = await db.auth.admin.getUserById(m.user_id);
        return { id: m.id, org_id: m.org_id, user_id: m.user_id, role: m.role, created_at: m.created_at, email: data.user?.email ?? null };
      })
    );
    return rows;
  });

  app.patch("/orgs/:orgId/members/:membershipId", async (req, reply) => {
    const { orgId, membershipId } = req.params as { orgId: string; membershipId: string };
    const body = updateMemberInput.parse(req.body);
    const { data: target, error: fetchErr } = await req.supabase
      .from("memberships")
      .select("role")
      .eq("id", membershipId)
      .eq("org_id", orgId)
      .maybeSingle();
    if (fetchErr) return sendDbError(reply, fetchErr);
    if (!target) return reply.code(404).send({ error: "not_found" });
    if ((target as any).role === "owner") {
      return reply.code(400).send({ error: "validation_error", message: "The organization owner's role can't be changed." });
    }
    const { data, error } = await req.supabase.from("memberships").update({ role: body.role }).eq("id", membershipId).select().maybeSingle();
    if (error) return sendDbError(reply, error);
    return data;
  });

  app.delete("/orgs/:orgId/members/:membershipId", async (req, reply) => {
    const { orgId, membershipId } = req.params as { orgId: string; membershipId: string };
    const { data: target, error: fetchErr } = await req.supabase
      .from("memberships")
      .select("role")
      .eq("id", membershipId)
      .eq("org_id", orgId)
      .maybeSingle();
    if (fetchErr) return sendDbError(reply, fetchErr);
    if (!target) return reply.code(404).send({ error: "not_found" });
    if ((target as any).role === "owner") {
      return reply.code(400).send({ error: "validation_error", message: "The organization owner can't be removed." });
    }
    const { error } = await req.supabase.from("memberships").delete().eq("id", membershipId);
    if (error) return sendDbError(reply, error);
    return reply.code(204).send();
  });
};
