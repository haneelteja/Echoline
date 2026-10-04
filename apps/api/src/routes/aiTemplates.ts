import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { decryptCredentials, loadMasterKey, rowToEnvelope } from "@echoline/db";
import { getAiCompleter } from "@echoline/providers";
import { sendDbError } from "../errors.js";

function masterKey() {
  return loadMasterKey(process.env.CREDENTIAL_VAULT_MASTER_KEY);
}

/** Strips a ```json ... ``` fence if the model wrapped its output in one
 * despite being asked for JSON only — common enough across providers that
 * not handling it would make "Return JSON only" an unreliable instruction. */
function parseJsonLoose(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return JSON.parse((fenced ? fenced[1] : text).trim());
}

async function buildKbContext(supabase: any, projectId: string): Promise<string> {
  const [{ data: project }, { data: brand }, { data: kbItems }, { data: contacts }] = await Promise.all([
    supabase.from("projects").select("name, brand, sender_name, website, wa_number").eq("id", projectId).single(),
    supabase.from("brand_kb").select("*").eq("project_id", projectId).maybeSingle(),
    supabase.from("kb_items").select("title, text").eq("project_id", projectId).not("text", "is", null),
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
  const notes =
    ((kbItems as any[]) ?? [])
      .map((k) => `${k.title}: ${k.text}`)
      .join(" | ")
      .slice(0, 3000) || "";

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

async function getAiCredentials(supabase: any, projectId: string): Promise<{ provider: string; credentials: Record<string, string> } | null> {
  const { data: conn } = await supabase
    .from("provider_connections")
    .select("*")
    .eq("project_id", projectId)
    .eq("kind", "ai")
    .eq("status", "connected")
    .maybeSingle();
  if (!conn) return null;
  const credentials = JSON.parse(decryptCredentials(rowToEnvelope(conn), masterKey()));
  return { provider: (conn as any).provider, credentials };
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

    const ai = await getAiCredentials(req.supabase, id);
    if (!ai) return reply.code(400).send({ error: "no_connection", message: "No connected AI provider for this project" });
    const completer = getAiCompleter(ai.provider);
    if (!completer) return reply.code(400).send({ error: "no_completer", message: `No completer implemented for provider ${ai.provider}` });

    const { data: project, error: projErr } = await req.supabase.from("projects").select("org_id").eq("id", id).maybeSingle();
    if (projErr) return sendDbError(reply, projErr);
    if (!project) return reply.code(404).send({ error: "not_found" });

    const isEmail = body.channel === "email";
    const kbContext = await buildKbContext(req.supabase, id);
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
      const raw = await completer(ai.credentials, { user: prompt, maxTokens: 4000 });
      parsed = parseJsonLoose(raw) as typeof parsed;
    } catch (err) {
      return reply.code(502).send({ error: "ai_generation_failed", message: err instanceof Error ? err.message : String(err) });
    }

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

    const ai = await getAiCredentials(req.supabase, projectId);
    if (!ai) return reply.code(400).send({ error: "no_connection", message: "No connected AI provider for this project" });
    const completer = getAiCompleter(ai.provider);
    if (!completer) return reply.code(400).send({ error: "no_completer", message: `No completer implemented for provider ${ai.provider}` });

    const { data: current, error: fetchErr } = await req.supabase
      .from("templates")
      .select("channel, name, step, subject, body, category_lines")
      .eq("project_id", projectId)
      .eq("id", templateId)
      .maybeSingle();
    if (fetchErr) return sendDbError(reply, fetchErr);
    if (!current) return reply.code(404).send({ error: "not_found" });
    const cur = current as { channel: string; name: string | null; step: number; subject: string | null; body: string | null; category_lines: Record<string, string> };

    const kbContext = await buildKbContext(req.supabase, projectId);
    const prompt = `Rewrite this ${cur.channel} outreach template. Keep placeholders like {{company}} intact. Use only facts from the knowledge base.
${kbContext}
CURRENT: ${JSON.stringify({ subject: cur.subject, body: cur.body, categoryLines: cur.category_lines })}
INSTRUCTION: ${body.instruction}
Return JSON only: {"subject":"…","body":"…","categoryLines":{…}}`;

    let parsed: { subject?: string; body?: string; categoryLines?: Record<string, string> };
    try {
      const raw = await completer(ai.credentials, { user: prompt, maxTokens: 2000 });
      parsed = parseJsonLoose(raw) as typeof parsed;
    } catch (err) {
      return reply.code(502).send({ error: "ai_rewrite_failed", message: err instanceof Error ? err.message : String(err) });
    }

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

    const ai = await getAiCredentials(req.supabase, id);
    if (!ai) return reply.code(400).send({ error: "no_connection", message: "No connected AI provider for this project" });
    const completer = getAiCompleter(ai.provider);
    if (!completer) return reply.code(400).send({ error: "no_completer", message: `No completer implemented for provider ${ai.provider}` });

    const { data: project, error: projErr } = await req.supabase.from("projects").select("name, brand").eq("id", id).maybeSingle();
    if (projErr) return sendDbError(reply, projErr);
    if (!project) return reply.code(404).send({ error: "not_found" });
    const p = project as { name: string; brand: string | null };

    const prompt = `You are a B2B outreach analyst for ${p.brand || p.name}. Here are campaign stats as JSON:
${JSON.stringify(body.stats)}
Write 4 short, specific, actionable observations (max 2 sentences each) as plain text lines starting with "• ". Base everything on the numbers; say when data is too thin. No preamble.`;

    try {
      const text = await completer(ai.credentials, { user: prompt, maxTokens: 500 });
      return { text };
    } catch (err) {
      return reply.code(502).send({ error: "ai_insights_failed", message: err instanceof Error ? err.message : String(err) });
    }
  });
};
