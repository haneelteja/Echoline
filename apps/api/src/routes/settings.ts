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

  app.put("/projects/:id/sequence", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as Record<string, unknown>;
    const { data, error } = await req.supabase
      .from("sequence_settings")
      .update({
        daily_cap: body.dailyCap,
        window_start: (body.window as any)?.start,
        window_end: (body.window as any)?.end,
        stop_on_reply: body.stopOnReply,
        em: body.em,
        wa: body.wa,
      })
      .eq("project_id", id)
      .select()
      .maybeSingle();
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
