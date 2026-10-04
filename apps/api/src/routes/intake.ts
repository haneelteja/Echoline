import type { FastifyPluginAsync } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { createHash, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@echoline/db";
import { normPhone, validEmail } from "@echoline/core";

// Any value in this field means a bot filled in something a real visitor
// never sees (hidden via CSS by whoever embeds the form) — silently accept
// without creating a contact, rather than telling the bot it was caught.
const HONEYPOT_FIELD = "website_url";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function timingSafeTokenEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/**
 * Public lead intake for webhook/website-form sources — no Supabase session,
 * auth is a per-source bearer token (see sources.ts for issuance). Accepts
 * both JSON (webhooks) and form-urlencoded (plain HTML <form> posts, which
 * can't set a custom Authorization header — the token may ride in the query
 * string instead for that case).
 *
 * De-dup rule matches the original prototype's Excel/CSV import: same email
 * or phone as an existing contact in this project is skipped, and an
 * existing contact's status is never overwritten by a re-synced source.
 */
export const intakeRoutes: FastifyPluginAsync = async (app) => {
  // Scoped to this route only (not the whole app) — a webhook/form sender is
  // a different trust tier than our own authenticated API traffic. In-memory
  // store is fine: Render's free/starter plans run a single instance, so
  // there's no multi-instance consistency to worry about yet.
  await app.register(rateLimit, {
    max: 20,
    timeWindow: "1 minute",
    keyGenerator: (req) => `${(req.params as { sourceId?: string }).sourceId}:${req.ip}`,
  });

  app.post("/intake/:sourceId", async (req, reply) => {
    const { sourceId } = req.params as { sourceId: string };
    const db = createAdminClient();

    const { data: source, error: sourceErr } = await db
      .from("lead_sources")
      .select("id, org_id, project_id, type, name, config, rows_added, rows_skipped, rows_failed")
      .eq("id", sourceId)
      .maybeSingle();
    if (sourceErr) return reply.code(500).send({ error: "internal_error" });
    if (!source) return reply.code(404).send({ error: "not_found" });
    const s = source as {
      id: string;
      org_id: string;
      project_id: string;
      type: string;
      name: string;
      config: Record<string, unknown>;
      rows_added: number;
      rows_skipped: number;
      rows_failed: number;
    };
    if (s.type !== "webhook" && s.type !== "form") return reply.code(404).send({ error: "not_found" });

    const authHeader = req.headers.authorization;
    const headerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
    const queryToken = (req.query as { token?: string })?.token;
    const token = headerToken ?? queryToken;
    const expectedHash = s.config?.tokenHash as string | undefined;
    if (!token || !expectedHash || !timingSafeTokenEqual(hashToken(token), expectedHash)) {
      return reply.code(401).send({ error: "invalid_token" });
    }

    const body = req.body as Record<string, string>;
    if (body?.[HONEYPOT_FIELD]) return reply.code(200).send({ ok: true });

    const name = body?.name?.trim();
    if (!name) {
      await db.from("lead_sources").update({ rows_failed: s.rows_failed + 1, last_sync: new Date().toISOString() }).eq("id", sourceId);
      return reply.code(400).send({ error: "validation_error", message: "name is required" });
    }

    const email = validEmail(body.email) ? body.email!.trim() : null;
    const phone = normPhone(body.phone) || null;

    if (email || phone) {
      const [byEmail, byPhone] = await Promise.all([
        email ? db.from("contacts").select("id").eq("project_id", s.project_id).ilike("email", email).maybeSingle() : Promise.resolve({ data: null }),
        phone ? db.from("contacts").select("id").eq("project_id", s.project_id).eq("phone", phone).maybeSingle() : Promise.resolve({ data: null }),
      ]);
      const existing = byEmail.data ?? byPhone.data;
      if (existing) {
        await db
          .from("lead_sources")
          .update({ rows_skipped: s.rows_skipped + 1, last_sync: new Date().toISOString() })
          .eq("id", sourceId);
        return reply.code(200).send({ ok: true, duplicate: true });
      }
    }

    const { data: contact, error: insertErr } = await db
      .from("contacts")
      .insert({
        org_id: s.org_id,
        project_id: s.project_id,
        name,
        contact_person: body.contactPerson ?? null,
        category: body.category ?? null,
        area: body.area ?? null,
        email,
        phone,
        source: s.name,
        em_status: "not_contacted",
        wa_status: "not_contacted",
      })
      .select("id")
      .single();
    if (insertErr) {
      await db.from("lead_sources").update({ rows_failed: s.rows_failed + 1, last_sync: new Date().toISOString() }).eq("id", sourceId);
      return reply.code(500).send({ error: "internal_error" });
    }

    await db
      .from("lead_sources")
      .update({ rows_added: s.rows_added + 1, last_sync: new Date().toISOString() })
      .eq("id", sourceId);

    return reply.code(201).send({ ok: true, contactId: (contact as { id: string }).id });
  });
};
