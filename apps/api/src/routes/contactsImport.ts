import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { normPhone, validEmail } from "@echoline/core";
import { sendDbError } from "../errors.js";

const importRow = z.object({
  name: z.string().trim().min(1),
  email: z.string().optional(),
  phone: z.string().optional(),
  category: z.string().optional(),
  area: z.string().optional(),
  contactPerson: z.string().optional(),
});

const importInput = z.object({
  rows: z.array(importRow).min(1).max(5000),
  source: z.string().trim().min(1).default("Excel import"),
});

/**
 * Bulk contact import from a client-parsed Excel/CSV file — the user maps
 * columns to our fields in the browser (apps/web parses with SheetJS, never
 * uploads the raw file), this just inserts the already-shaped rows. Runs
 * through the caller's own RLS, same as collections.ts's single-row POST.
 * De-dup matches intake.ts exactly: same email or phone as an existing
 * contact in this project is skipped, existing status never overwritten.
 */
export const contactsImportRoutes: FastifyPluginAsync = async (app) => {
  app.post("/projects/:id/contacts/import", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = importInput.parse(req.body);

    const { data: project, error: projErr } = await req.supabase.from("projects").select("org_id").eq("id", id).maybeSingle();
    if (projErr) return sendDbError(reply, projErr);
    if (!project) return reply.code(404).send({ error: "not_found" });
    const orgId = (project as { org_id: string }).org_id;

    let added = 0;
    let skipped = 0;
    let failed = 0;

    for (const row of body.rows) {
      const name = row.name.trim();
      const email = validEmail(row.email) ? row.email!.trim() : null;
      const phone = normPhone(row.phone) || null;

      if (email || phone) {
        const [byEmail, byPhone] = await Promise.all([
          email
            ? req.supabase.from("contacts").select("id").eq("project_id", id).ilike("email", email).maybeSingle()
            : Promise.resolve({ data: null }),
          phone
            ? req.supabase.from("contacts").select("id").eq("project_id", id).eq("phone", phone).maybeSingle()
            : Promise.resolve({ data: null }),
        ]);
        if (byEmail.data ?? byPhone.data) {
          skipped++;
          continue;
        }
      }

      const { error } = await req.supabase.from("contacts").insert({
        org_id: orgId,
        project_id: id,
        name,
        contact_person: row.contactPerson?.trim() || null,
        category: row.category?.trim() || null,
        area: row.area?.trim() || null,
        email,
        phone,
        source: body.source,
        em_status: "not_contacted",
        wa_status: "not_contacted",
      });
      if (error) failed++;
      else added++;
    }

    return { added, skipped, failed };
  });
};
