import type { FastifyPluginAsync } from "fastify";
import { sendDbError } from "../errors.js";

/** 1:1 project settings: sequence, channels, brand/knowledge-base facts. */
export const settingsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/projects/:id/sequence", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { data, error } = await req.supabase.from("sequence_settings").select("*").eq("project_id", id).maybeSingle();
    if (error) return sendDbError(reply, error);
    return data;
  });

  // Partial update — stop_on_reply now saves independently from the Project
  // settings page (apps/web's Sequence page only ever sends em/wa), so a
  // plain `update({stop_on_reply, em, wa})` with em/wa undefined would null
  // them out instead of leaving them untouched.
  app.put("/projects/:id/sequence", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as Record<string, unknown>;
    const update: Record<string, unknown> = {};
    if ("stopOnReply" in body) update.stop_on_reply = body.stopOnReply;
    if ("em" in body) update.em = body.em;
    if ("wa" in body) update.wa = body.wa;
    const { data, error } = await req.supabase.from("sequence_settings").update(update).eq("project_id", id).select().maybeSingle();
    if (error) return sendDbError(reply, error);
    return data;
  });

  app.get("/projects/:id/channels", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { data, error } = await req.supabase.from("channel_settings").select("*").eq("project_id", id).maybeSingle();
    if (error) return sendDbError(reply, error);
    return data;
  });

  app.put("/projects/:id/channels", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as Record<string, unknown>;
    const { data, error } = await req.supabase
      .from("channel_settings")
      .update({ email: body.email, wa: body.wa })
      .eq("project_id", id)
      .select()
      .maybeSingle();
    if (error) return sendDbError(reply, error);
    return data;
  });

  app.get("/projects/:id/brand", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { data, error } = await req.supabase.from("brand_kb").select("*").eq("project_id", id).maybeSingle();
    if (error) return sendDbError(reply, error);
    return data;
  });

  app.put("/projects/:id/brand", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as Record<string, unknown>;
    const { data, error } = await req.supabase
      .from("brand_kb")
      .update({
        about: body.about,
        offer: body.offer,
        pricing: body.pricing,
        tone: body.tone,
        cta: body.cta,
        skus: body.skus,
      })
      .eq("project_id", id)
      .select()
      .maybeSingle();
    if (error) return sendDbError(reply, error);
    return data;
  });
};
