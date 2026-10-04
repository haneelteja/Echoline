import type { FastifyPluginAsync } from "fastify";
import { randomBytes, createHash } from "node:crypto";
import { sendDbError } from "../errors.js";
import { getSchedulerQueue } from "../schedulerQueue.js";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Issues (or rotates) the bearer token a webhook/form lead source uses to
 * authenticate with the public /intake/:sourceId endpoint. Only a hash is
 * stored (config.tokenHash) — the plaintext is returned once, here, same as
 * any API-key-issuance flow; losing it means generating a new one.
 */
export const sourcesRoutes: FastifyPluginAsync = async (app) => {
  app.post("/projects/:projectId/sources/:sourceId/token", async (req, reply) => {
    const { projectId, sourceId } = req.params as { projectId: string; sourceId: string };
    const { data: source, error: fetchErr } = await req.supabase
      .from("lead_sources")
      .select("id, type, config")
      .eq("project_id", projectId)
      .eq("id", sourceId)
      .maybeSingle();
    if (fetchErr) return sendDbError(reply, fetchErr);
    if (!source) return reply.code(404).send({ error: "not_found" });
    const s = source as { id: string; type: string; config: Record<string, unknown> };
    if (s.type !== "webhook" && s.type !== "form") {
      return reply.code(400).send({ error: "validation_error", message: "Only webhook/form sources use a token" });
    }

    const token = randomBytes(24).toString("base64url");
    const { error: updateErr } = await req.supabase
      .from("lead_sources")
      .update({ config: { ...s.config, tokenHash: hashToken(token) } })
      .eq("id", sourceId);
    if (updateErr) return sendDbError(reply, updateErr);

    return { token };
  });

  // Manual "Sync now" for onedrive/google_sheets sources — enqueues onto the
  // same scheduler queue the worker's repeatable tick uses (mirrors
  // projects.ts's run-due trigger), just scoped to one source by id.
  app.post("/projects/:projectId/sources/:sourceId/sync", async (req, reply) => {
    const { projectId, sourceId } = req.params as { projectId: string; sourceId: string };
    const { data: source, error: fetchErr } = await req.supabase
      .from("lead_sources")
      .select("id, type")
      .eq("project_id", projectId)
      .eq("id", sourceId)
      .maybeSingle();
    if (fetchErr) return sendDbError(reply, fetchErr);
    if (!source) return reply.code(404).send({ error: "not_found" });
    const s = source as { id: string; type: string };
    if (s.type !== "onedrive" && s.type !== "google_sheets") {
      return reply.code(400).send({ error: "validation_error", message: "Only onedrive/google_sheets sources can be synced" });
    }

    await getSchedulerQueue().add("manual-source-sync", { sourceId }, { removeOnComplete: 100, removeOnFail: 100 });
    return { ok: true };
  });
};
