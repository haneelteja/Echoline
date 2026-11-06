import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { z } from "zod";
import { getAiCompleter, getEmbedder, getImageGenerator } from "@echoline/providers";
import { sendDbError } from "../errors.js";
import { checkAiUsageLimit, recordAiUsage } from "../aiUsage.js";
import { getAiConnections, selectProviderAndModel, estimateTokens, type AiConnection } from "../aiRouter.js";

/** Shared by every route below — sends the 429 itself and returns false when
 * the org is over its monthly AI call cap, so each call site just does
 * `if (!(await enforceAiUsageLimit(orgId, reply))) return;`. */
async function enforceAiUsageLimit(orgId: string, reply: FastifyReply): Promise<boolean> {
  const usage = await checkAiUsageLimit(orgId);
  if (usage.ok) return true;
  reply.code(429).send({ error: "ai_usage_limit_reached", message: `This org has reached its AI usage limit for this month (${usage.used}/${usage.limit} calls).` });
  return false;
}

/** Strips a ```json ... ``` fence if the model wrapped its output in one
 * despite being asked for JSON only — common enough across providers that
 * not handling it would make "Return JSON only" an unreliable instruction. */
function parseJsonLoose(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return JSON.parse((fenced ? fenced[1] : text).trim());
}

/**
 * Backfills any kb_items missing an embedding (best-effort — a failure here
 * shouldn't block context building, it just means that item stays
 * text-only this time and gets retried next call). Only runs when the
 * connected provider can actually produce one; see Embedder's doc comment
 * in packages/providers for why that's OpenAI only.
 */
async function backfillKbEmbeddings(supabase: any, projectId: string, ai: { provider: string; credentials: Record<string, string> }): Promise<void> {
  const embedder = getEmbedder(ai.provider);
  if (!embedder) return;
  const { data: missing } = await supabase.from("kb_items").select("id, text").eq("project_id", projectId).is("embedding", null).not("text", "is", null);
  for (const item of (missing as { id: string; text: string }[]) ?? []) {
    try {
      const vector = await embedder(ai.credentials, item.text);
      await supabase.from("kb_items").update({ embedding: vector }).eq("id", item.id);
    } catch {
      // best-effort — leave it for the next call to retry
    }
  }
}

/**
 * Real pgvector similarity search when the connected provider supports
 * embeddings (OpenAI); otherwise falls back to concatenating every
 * kb_items row as plain text, same as before this existed. brand_kb
 * (about/offer/pricing/tone/cta/skus) is small and structured — always
 * included in full regardless, it's not a retrieval candidate.
 */
async function buildKbContext(supabase: any, projectId: string, query: string, ai: { provider: string; credentials: Record<string, string> }): Promise<string> {
  const [{ data: project }, { data: brand }, { data: contacts }] = await Promise.all([
    supabase.from("projects").select("name, brand, sender_name, website, wa_number").eq("id", projectId).single(),
    supabase.from("brand_kb").select("*").eq("project_id", projectId).maybeSingle(),
    supabase.from("contacts").select("category").eq("project_id", projectId).not("category", "is", null),
  ]);
  const p = (project as any) ?? {};
  const b = (brand as any) ?? {};
  const categories = [...new Set(((contacts as any[]) ?? []).map((c) => c.category).filter(Boolean))];
  const skus = (b.skus ?? []) as { code?: string; name?: string; size?: string; price?: number; moq?: number }[];
  const skuLine =
    skus
      .map((s) => [s.code, s.name, s.size, s.price ? `₹${s.price}` : null, s.moq ? `MOQ ${s.moq}` : null].filter(Boolean).join(" / "))
      .join("; ") || "none listed";

  let notes = "";
  const embedder = getEmbedder(ai.provider);
  if (embedder) {
    await backfillKbEmbeddings(supabase, projectId, ai);
    try {
      const queryVector = await embedder(ai.credentials, query);
      const { data: matches } = await supabase.rpc("match_kb_items", { query_embedding: queryVector, p_project_id: projectId, match_count: 5 });
      notes = ((matches as { title: string; text: string }[]) ?? []).map((m) => `${m.title}: ${m.text}`).join(" | ");
    } catch {
      notes = ""; // embedding/search failed mid-request — proceed without notes rather than fail the whole generation
    }
  } else {
    const { data: kbItems } = await supabase.from("kb_items").select("title, text").eq("project_id", projectId).not("text", "is", null);
    notes = ((kbItems as any[]) ?? [])
      .map((k) => `${k.title}: ${k.text}`)
      .join(" | ")
      .slice(0, 3000);
  }

  return `BRAND: ${p.brand || p.name}. Sender: ${p.sender_name || ""}. Website: ${p.website || ""}. WhatsApp: ${p.wa_number || ""}.
ABOUT: ${b.about || ""}
OFFER / USP: ${b.offer || ""}
PRICING NOTES: ${b.pricing || ""}
TONE: ${b.tone || "warm, concise, professional, Indian B2B"}
CALL TO ACTION: ${b.cta || ""}
SKUS: ${skuLine}
OTHER NOTES: ${notes}
LEAD CATEGORIES IN THIS PROJECT: ${categories.join(", ") || "Restaurant, Hotel, Banquet Hall, Car Dealer / Retail Showroom"}`;
}

// Embeddings are a separate concern from which provider the orchestrator
// picks for a completion — only OpenAI implements Embedder (see its doc
// comment in packages/providers), so KB retrieval always uses the
// project's own OpenAI connection specifically, if one is connected,
// regardless of which provider selectProviderAndModel ends up picking for
// the actual generation/rewrite/insights/copilot call.
function embeddingConnection(connections: AiConnection[]): AiConnection {
  return connections.find((c) => c.provider === "openai") ?? connections[0];
}

const generateInput = z.object({
  channel: z.enum(["email", "whatsapp"]),
  goal: z.string().min(1),
  steps: z.number().int().min(1).max(3),
  extra: z.string().optional(),
});

const rewriteInput = z.object({ instruction: z.string().min(1) });

// Open-ended — the dashboard sends whatever stats shape it has already
// computed (leads/reached/engaged/replied, per-channel sent/open/read
// rates, category and area breakdowns, 14-day trend). Validating only that
// it's a JSON object avoids this route needing to know the dashboard's
// exact stats shape, which would make the two drift out of sync.
const insightsInput = z.object({ stats: z.record(z.unknown()) });

const imageGenerateInput = z.object({ prompt: z.string().min(1) });

const copilotInput = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1) })).min(1),
});

/**
 * AI template generation/rewrite — gated to org-admins, same reasoning as
 * waTemplates.ts and connections.ts: reads the project's connected AI
 * provider credentials, and provider_connections is admin-only via RLS.
 * Runs through the caller's own req.supabase/RLS context throughout.
 */
export const aiTemplatesRoutes: FastifyPluginAsync = async (app) => {
  app.post("/projects/:id/templates/ai-generate", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = generateInput.parse(req.body);

    const connections = await getAiConnections(req.supabase, id);
    if (!connections.length) return reply.code(400).send({ error: "no_connection", message: "No connected AI provider for this project" });

    const { data: project, error: projErr } = await req.supabase.from("projects").select("org_id").eq("id", id).maybeSingle();
    if (projErr) return sendDbError(reply, projErr);
    if (!project) return reply.code(404).send({ error: "not_found" });
    const orgId = (project as any).org_id as string;

    if (!(await enforceAiUsageLimit(orgId, reply))) return;

    const isEmail = body.channel === "email";
    const kbContext = await buildKbContext(req.supabase, id, `${body.goal} ${body.extra ?? ""}`.trim(), embeddingConnection(connections));
    const prompt = `You write B2B outreach ${isEmail ? "emails" : "WhatsApp messages"} for an Indian business. Use only facts from the knowledge base below; never invent prices or claims.
${kbContext}
CAMPAIGN GOAL: ${body.goal}
EXTRA: ${body.extra ?? ""}
Write ${body.steps} step(s): step 0 is the first cold message${body.steps > 1 ? ", then follow-ups that are shorter, reference the earlier note, and add one new reason to reply" : ""}${body.steps > 2 ? "; the last is a polite final check-in that leaves the door open" : ""}.
Use these placeholders exactly where relevant: {{company}}, {{area_phrase}} (renders as " in Gachibowli" or empty), {{category_line}} (a category-specific clause, step 0 only), {{contact_name}}, {{brand}}, {{sender_name}}.
${isEmail ? "Email body: plain text, paragraphs separated by a blank line; you may include one highlight block where every line starts with '• '. Do not include the signature or opt-out line (added automatically). Subject lines under 50 characters; follow-ups use 'Re: ' + the first subject." : "WhatsApp: under 400 characters, 1 emoji max, sign off with the sender's first name and brand. Suitable to submit as a Meta utility/marketing template."}
For step 0 also write categoryLines: an object whose keys are each lead category listed plus "default", value = one clause completing "I came across {{company}}{{area_phrase}} and ..." tailored to that category.
Return JSON only: {"templates":[{"step":0,"name":"short name","subject":"${isEmail ? "…" : ""}","body":"…","categoryLines":{"default":"…"}}]}`;

    let parsed: { templates?: { step: number; name?: string; subject?: string; body?: string; categoryLines?: Record<string, string> }[] };
    try {
      const picked = await selectProviderAndModel(req.supabase, connections, "template_generate", estimateTokens(prompt, 4000));
      const completer = getAiCompleter(picked.provider);
      if (!completer) throw new Error(`No completer implemented for provider ${picked.provider}`);
      const raw = await completer(picked.credentials, { user: prompt, maxTokens: 4000 });
      parsed = parseJsonLoose(raw) as typeof parsed;
    } catch (err) {
      return reply.code(502).send({ error: "ai_generation_failed", message: err instanceof Error ? err.message : String(err) });
    }
    await recordAiUsage(orgId, id, req.log);

    const rows = (parsed.templates ?? []).map((x) => ({
      org_id: (project as any).org_id,
      project_id: id,
      channel: body.channel,
      step: x.step ?? 0,
      name: x.name || `Step ${(x.step ?? 0) + 1}`,
      subject: isEmail ? x.subject ?? "" : "",
      body: x.body ?? "",
      category_lines: x.categoryLines ?? { default: "" },
      ai: true,
      meta_status: isEmail ? null : "Draft",
    }));
    if (!rows.length) return reply.code(502).send({ error: "ai_generation_failed", message: "Model returned no templates" });

    const { data, error } = await req.supabase.from("templates").insert(rows).select();
    if (error) return sendDbError(reply, error);
    return reply.code(201).send(data);
  });

  app.post("/projects/:projectId/templates/:templateId/ai-rewrite", async (req, reply) => {
    const { projectId, templateId } = req.params as { projectId: string; templateId: string };
    const body = rewriteInput.parse(req.body);

    const connections = await getAiConnections(req.supabase, projectId);
    if (!connections.length) return reply.code(400).send({ error: "no_connection", message: "No connected AI provider for this project" });

    const { data: project, error: projErr } = await req.supabase.from("projects").select("org_id").eq("id", projectId).maybeSingle();
    if (projErr) return sendDbError(reply, projErr);
    if (!project) return reply.code(404).send({ error: "not_found" });
    const orgId = (project as any).org_id as string;

    if (!(await enforceAiUsageLimit(orgId, reply))) return;

    const { data: current, error: fetchErr } = await req.supabase
      .from("templates")
      .select("channel, name, step, subject, body, category_lines")
      .eq("project_id", projectId)
      .eq("id", templateId)
      .maybeSingle();
    if (fetchErr) return sendDbError(reply, fetchErr);
    if (!current) return reply.code(404).send({ error: "not_found" });
    const cur = current as { channel: string; name: string | null; step: number; subject: string | null; body: string | null; category_lines: Record<string, string> };

    const kbContext = await buildKbContext(req.supabase, projectId, body.instruction, embeddingConnection(connections));
    const prompt = `Rewrite this ${cur.channel} outreach template. Keep placeholders like {{company}} intact. Use only facts from the knowledge base.
${kbContext}
CURRENT: ${JSON.stringify({ subject: cur.subject, body: cur.body, categoryLines: cur.category_lines })}
INSTRUCTION: ${body.instruction}
Return JSON only: {"subject":"…","body":"…","categoryLines":{…}}`;

    let parsed: { subject?: string; body?: string; categoryLines?: Record<string, string> };
    try {
      const picked = await selectProviderAndModel(req.supabase, connections, "template_rewrite", estimateTokens(prompt, 2000));
      const completer = getAiCompleter(picked.provider);
      if (!completer) throw new Error(`No completer implemented for provider ${picked.provider}`);
      const raw = await completer(picked.credentials, { user: prompt, maxTokens: 2000 });
      parsed = parseJsonLoose(raw) as typeof parsed;
    } catch (err) {
      return reply.code(502).send({ error: "ai_rewrite_failed", message: err instanceof Error ? err.message : String(err) });
    }
    await recordAiUsage(orgId, projectId, req.log);

    const { data, error } = await req.supabase
      .from("templates")
      .update({
        body: parsed.body ?? cur.body,
        subject: parsed.subject ?? cur.subject ?? "",
        category_lines: parsed.categoryLines ?? cur.category_lines,
        ai: true,
      })
      .eq("id", templateId)
      .select()
      .single();
    if (error) return sendDbError(reply, error);
    return data;
  });

  // Same prompt/shape as the original prototype's "Ask AI" button — a short
  // analyst read on whatever campaign stats the dashboard already computed,
  // not a new round-trip to recompute them server-side.
  app.post("/projects/:id/insights/ai", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = insightsInput.parse(req.body);

    const connections = await getAiConnections(req.supabase, id);
    if (!connections.length) return reply.code(400).send({ error: "no_connection", message: "No connected AI provider for this project" });

    const { data: project, error: projErr } = await req.supabase.from("projects").select("name, brand, org_id").eq("id", id).maybeSingle();
    if (projErr) return sendDbError(reply, projErr);
    if (!project) return reply.code(404).send({ error: "not_found" });
    const p = project as { name: string; brand: string | null; org_id: string };

    if (!(await enforceAiUsageLimit(p.org_id, reply))) return;

    const prompt = `You are a B2B outreach analyst for ${p.brand || p.name}. Here are campaign stats as JSON:
${JSON.stringify(body.stats)}
Write 4 short, specific, actionable observations (max 2 sentences each) as plain text lines starting with "• ". Base everything on the numbers; say when data is too thin. No preamble.`;

    try {
      const picked = await selectProviderAndModel(req.supabase, connections, "insights", estimateTokens(prompt, 2000));
      const completer = getAiCompleter(picked.provider);
      if (!completer) throw new Error(`No completer implemented for provider ${picked.provider}`);
      const text = await completer(picked.credentials, { user: prompt, maxTokens: 2000 });
      await recordAiUsage(p.org_id, id, req.log);
      return { text };
    } catch (err) {
      return reply.code(502).send({ error: "ai_insights_failed", message: err instanceof Error ? err.message : String(err) });
    }
  });

  // New image generation + copilot tasks both route through the same
  // selectProviderAndModel mechanism as the three text tasks above.
  app.post("/projects/:id/kb/ai-generate-image", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = imageGenerateInput.parse(req.body);

    const connections = await getAiConnections(req.supabase, id);
    if (!connections.length) return reply.code(400).send({ error: "no_connection", message: "No connected AI provider for this project" });

    const { data: project, error: projErr } = await req.supabase.from("projects").select("org_id").eq("id", id).maybeSingle();
    if (projErr) return sendDbError(reply, projErr);
    if (!project) return reply.code(404).send({ error: "not_found" });
    const orgId = (project as any).org_id as string;

    if (!(await enforceAiUsageLimit(orgId, reply))) return;

    let image: { base64: string; mimeType: string };
    try {
      const picked = await selectProviderAndModel(req.supabase, connections, "image_generate", { prompt: 0, completion: 0 });
      const generator = getImageGenerator(picked.provider);
      if (!generator) {
        throw new Error(`No image generator implemented for provider ${picked.provider} — connect OpenRouter for image generation.`);
      }
      image = await generator(picked.credentials, body.prompt);
      await recordAiUsage(orgId, id, req.log);
    } catch (err) {
      return reply.code(502).send({ error: "ai_image_generation_failed", message: err instanceof Error ? err.message : String(err) });
    }

    const ext = image.mimeType.split("/")[1] ?? "png";
    const storagePath = `${id}/ai-generated/${Date.now()}.${ext}`;
    const bytes = Buffer.from(image.base64, "base64");
    const { error: uploadErr } = await req.supabase.storage.from("kb-assets").upload(storagePath, bytes, { contentType: image.mimeType });
    if (uploadErr) return reply.code(502).send({ error: "storage_upload_failed", message: uploadErr.message });
    const { data: publicUrl } = req.supabase.storage.from("kb-assets").getPublicUrl(storagePath);

    const { data, error } = await req.supabase
      .from("kb_assets")
      .insert({
        project_id: id,
        org_id: orgId,
        kind: "image",
        name: `AI: ${body.prompt.slice(0, 60)}`,
        mime_type: image.mimeType,
        size_bytes: bytes.byteLength,
        storage_path: storagePath,
        url: publicUrl.publicUrl,
      })
      .select()
      .single();
    if (error) return sendDbError(reply, error);
    return reply.code(201).send(data);
  });

  // Non-streaming v1 — real multi-turn context, single request/response.
  // True SSE streaming is a deliberate, separable follow-up (see docs/ROADMAP.md).
  app.post("/projects/:id/copilot", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = copilotInput.parse(req.body);

    const connections = await getAiConnections(req.supabase, id);
    if (!connections.length) return reply.code(400).send({ error: "no_connection", message: "No connected AI provider for this project" });

    const { data: project, error: projErr } = await req.supabase.from("projects").select("org_id").eq("id", id).maybeSingle();
    if (projErr) return sendDbError(reply, projErr);
    if (!project) return reply.code(404).send({ error: "not_found" });
    const orgId = (project as any).org_id as string;

    if (!(await enforceAiUsageLimit(orgId, reply))) return;

    const lastUserMessage = body.messages.filter((m) => m.role === "user").pop()?.content ?? "";
    const kbContext = await buildKbContext(req.supabase, id, lastUserMessage, embeddingConnection(connections));
    const system = `You are a helpful assistant for the team running outreach for this business. Use only facts from the knowledge base below; say when you don't know something rather than inventing it.
${kbContext}`;

    try {
      const picked = await selectProviderAndModel(req.supabase, connections, "copilot_chat", estimateTokens(system + lastUserMessage, 2000));
      const completer = getAiCompleter(picked.provider);
      if (!completer) throw new Error(`No completer implemented for provider ${picked.provider}`);
      const reply_ = await completer(picked.credentials, { system, user: lastUserMessage, messages: body.messages, maxTokens: 2000 });
      await recordAiUsage(orgId, id, req.log);
      return { reply: reply_ };
    } catch (err) {
      return reply.code(502).send({ error: "ai_copilot_failed", message: err instanceof Error ? err.message : String(err) });
    }
  });
};
