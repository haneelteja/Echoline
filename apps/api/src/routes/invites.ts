import type { FastifyPluginAsync } from "fastify";
import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import { createAdminClient } from "@echoline/db";
import { sendDbError } from "../errors.js";
import { sendInviteEmail } from "../platformEmail.js";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

const INVITABLE_ROLES = ["admin", "viewer", "project_viewer"] as const;
const createInviteInput = z.object({ email: z.string().email(), role: z.enum(INVITABLE_ROLES) });

/** Authenticated routes — registered inside the /v1 group, same as everything else. */
export const inviteRoutes: FastifyPluginAsync = async (app) => {
  app.post("/orgs/:orgId/invites", async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const body = createInviteInput.parse(req.body);

    const { data: org, error: orgErr } = await req.supabase.from("organizations").select("name").eq("id", orgId).maybeSingle();
    if (orgErr) return sendDbError(reply, orgErr);
    if (!org) return reply.code(404).send({ error: "not_found" });

    const token = randomBytes(24).toString("base64url");
    // Insert through the caller's own RLS context (can_admin_org-gated) —
    // a non-admin gets a 403 here, same as any other admin-only write.
    const { data: invite, error } = await req.supabase
      .from("invites")
      .insert({ org_id: orgId, email: body.email, role: body.role, invited_by: req.userId, token_hash: hashToken(token) })
      .select()
      .single();
    if (error) return sendDbError(reply, error);

    const webUrl = process.env.WEB_PUBLIC_URL ?? "";
    try {
      await sendInviteEmail({
        to: body.email,
        orgName: (org as any).name,
        inviterEmail: req.userEmail,
        role: body.role,
        acceptUrl: `${webUrl}/accept-invite?token=${token}`,
      });
    } catch (err) {
      // The invite row is already saved — a resend (re-calling this with the
      // same email) is always possible, so a delivery failure here shouldn't
      // look like the whole operation failed, just that email didn't go out.
      req.log.error({ err }, "failed to send invite email");
      return reply.code(502).send({ error: "email_failed", message: err instanceof Error ? err.message : "Couldn't send the invite email." });
    }
    return reply.code(201).send(invite);
  });

  app.get("/orgs/:orgId/invites", async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    const { data, error } = await req.supabase
      .from("invites")
      .select("id, org_id, email, role, status, expires_at, created_at")
      .eq("org_id", orgId)
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    if (error) return sendDbError(reply, error);
    return data;
  });

  app.post("/orgs/:orgId/invites/:inviteId/revoke", async (req, reply) => {
    const { orgId, inviteId } = req.params as { orgId: string; inviteId: string };
    const { data, error } = await req.supabase
      .from("invites")
      .update({ status: "revoked" })
      .eq("id", inviteId)
      .eq("org_id", orgId)
      .select()
      .maybeSingle();
    if (error) return sendDbError(reply, error);
    if (!data) return reply.code(404).send({ error: "not_found" });
    return data;
  });

  // The invitee has no org access yet, so can_admin_org can't gate this —
  // the admin client verifies the token/expiry/email match by hand instead,
  // then performs the one membership insert RLS would otherwise block.
  app.post("/invites/accept", async (req, reply) => {
    const { token } = z.object({ token: z.string().min(1) }).parse(req.body);
    const db = createAdminClient();
    const { data: invite, error } = await db.from("invites").select("*").eq("token_hash", hashToken(token)).maybeSingle();
    if (error) return sendDbError(reply, error);
    if (!invite) return reply.code(404).send({ error: "not_found", message: "This invite link isn't valid." });
    const inv = invite as any;
    if (inv.status === "revoked") return reply.code(410).send({ error: "revoked", message: "This invite was revoked." });
    if (inv.status === "accepted") return reply.code(410).send({ error: "already_accepted", message: "This invite was already accepted." });
    if (new Date(inv.expires_at).getTime() < Date.now()) return reply.code(410).send({ error: "expired", message: "This invite has expired." });
    if (inv.email.toLowerCase() !== req.userEmail.toLowerCase()) {
      return reply.code(403).send({ error: "email_mismatch", message: `This invite was sent to ${inv.email} — sign in with that address to accept it.` });
    }

    const { data: existing } = await db.from("memberships").select("id").eq("org_id", inv.org_id).eq("user_id", req.userId).maybeSingle();
    if (!existing) {
      const { error: memErr } = await db.from("memberships").insert({ org_id: inv.org_id, user_id: req.userId, role: inv.role });
      if (memErr) return sendDbError(reply, memErr);
    }
    await db.from("invites").update({ status: "accepted", accepted_at: new Date().toISOString() }).eq("id", inv.id);
    return { orgId: inv.org_id };
  });
};

/** Public preview — no auth, the token itself is the secret. Lets the
 * accept-invite page show "you're invited to X as Y" before/while the
 * visitor signs in, same reasoning as intake.ts's token-gated public routes. */
export const publicInviteRoutes: FastifyPluginAsync = async (app) => {
  app.get("/invites/preview", async (req, reply) => {
    const { token } = req.query as { token?: string };
    if (!token) return reply.code(400).send({ error: "validation_error", message: "token is required" });
    const db = createAdminClient();
    const { data: invite } = await db.from("invites").select("org_id, email, role, status, expires_at").eq("token_hash", hashToken(token)).maybeSingle();
    if (!invite) return reply.code(404).send({ error: "not_found" });
    const inv = invite as any;
    const { data: org } = await db.from("organizations").select("name").eq("id", inv.org_id).maybeSingle();
    const valid = inv.status === "pending" && new Date(inv.expires_at).getTime() >= Date.now();
    return { orgName: (org as any)?.name ?? "", email: inv.email, role: inv.role, valid, status: inv.status };
  });
};
