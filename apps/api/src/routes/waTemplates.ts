import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { decryptCredentials, loadMasterKey, rowToEnvelope } from "@echoline/db";
import { submitMetaTemplate } from "@echoline/providers";
import { deriveMetaTemplateComponents } from "@echoline/core";
import { sendDbError } from "../errors.js";

function masterKey() {
  return loadMasterKey(process.env.CREDENTIAL_VAULT_MASTER_KEY);
}

const submitInput = z.object({
  metaName: z.string().min(1),
  language: z.string().default("en"),
  category: z.enum(["MARKETING", "UTILITY", "AUTHENTICATION"]),
});

/**
 * Submits a WhatsApp template to Meta for approval. Gated to org-admins, not
 * just operators — same justification as connections.ts: this reads the
 * project's connected Meta credentials, and provider_connections is
 * admin-only via RLS (migration 0002). Runs entirely through the caller's
 * own req.supabase/RLS context rather than an admin-client bypass, so an
 * admin here naturally has both the connection read and the templates write
 * access it needs.
 */
export const waTemplatesRoutes: FastifyPluginAsync = async (app) => {
  app.post("/projects/:projectId/templates/:templateId/submit-whatsapp", async (req, reply) => {
    const { projectId, templateId } = req.params as { projectId: string; templateId: string };
    const body = submitInput.parse(req.body);

    const { data: template, error: tplErr } = await req.supabase
      .from("templates")
      .select("id, org_id, channel, body")
      .eq("project_id", projectId)
      .eq("id", templateId)
      .maybeSingle();
    if (tplErr) return sendDbError(reply, tplErr);
    if (!template) return reply.code(404).send({ error: "not_found" });
    const t = template as { id: string; org_id: string; channel: string; body: string | null };
    if (t.channel !== "whatsapp") return reply.code(400).send({ error: "validation_error", message: "Not a WhatsApp template" });

    const { data: conn, error: connErr } = await req.supabase
      .from("provider_connections")
      .select("*")
      .eq("project_id", projectId)
      .eq("kind", "whatsapp")
      .eq("provider", "meta")
      .eq("status", "connected")
      .maybeSingle();
    if (connErr) return sendDbError(reply, connErr);
    if (!conn) return reply.code(400).send({ error: "no_connection", message: "No connected Meta WhatsApp provider for this project" });

    let credentials: Record<string, string>;
    try {
      credentials = JSON.parse(decryptCredentials(rowToEnvelope(conn as any), masterKey()));
    } catch {
      return reply.code(500).send({ error: "decrypt_failed" });
    }
    if (!credentials.wabaId) {
      return reply.code(400).send({ error: "missing_waba_id", message: "Connect a WhatsApp Business Account ID on this Meta connection first" });
    }

    const { metaBody, variableMap, examples } = deriveMetaTemplateComponents(t.body ?? "");

    let submission;
    try {
      submission = await submitMetaTemplate(credentials, {
        name: body.metaName,
        language: body.language,
        category: body.category,
        bodyText: metaBody,
        bodyExamples: examples,
      });
    } catch (err) {
      return reply.code(502).send({ error: "meta_submission_failed", message: err instanceof Error ? err.message : String(err) });
    }

    // Meta's own status vocabulary (PENDING/APPROVED/REJECTED) normalized to
    // this app's existing Title Case convention (templates.meta_status
    // already defaults to "Draft", and the worker gates sends on "Approved").
    const normalizedStatus = submission.status.charAt(0) + submission.status.slice(1).toLowerCase();

    const { data: waTemplate, error: upsertErr } = await req.supabase
      .from("wa_templates")
      .upsert(
        {
          org_id: t.org_id,
          project_id: projectId,
          template_id: templateId,
          meta_name: body.metaName,
          language: body.language,
          category: body.category,
          status: normalizedStatus,
          variable_map: variableMap,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "template_id" }
      )
      .select()
      .single();
    if (upsertErr) return sendDbError(reply, upsertErr);

    const { error: tplUpdateErr } = await req.supabase
      .from("templates")
      .update({ meta_name: body.metaName, meta_status: normalizedStatus })
      .eq("id", templateId);
    if (tplUpdateErr) return sendDbError(reply, tplUpdateErr);

    return reply.code(201).send({ ...waTemplate, metaTemplateId: submission.metaTemplateId });
  });
};
