import { createAdminClient, decryptCredentials, loadMasterKey, rowToEnvelope } from "@echoline/db";
import {
  fetchAndConsumeUnseenImapMessages,
  getAiCompleter,
  pickModel,
  buildCandidates,
  parseCandidateId,
  type AiProviderId,
  type CatalogRow,
} from "@echoline/providers";
import type { Logger } from "pino";

function masterKey() {
  return loadMasterKey(process.env.CREDENTIAL_VAULT_MASTER_KEY);
}

const OPT_OUT_KEYWORDS = new Set(["stop", "unsubscribe", "cancel", "end", "quit", "opt out", "optout"]);
function isOptOutText(text: string): boolean {
  return OPT_OUT_KEYWORDS.has(text.trim().toLowerCase());
}

// Cheap, no-AI-required safety net for rule 2 (quote/sample request -> sales
// pipeline) when a project has no AI provider connected, its monthly AI call
// cap is already hit, or the classification call itself fails for any
// reason — "contains" matching (unlike OPT_OUT_KEYWORDS' exact match) since a
// real reply is a sentence, not a single word.
const QUOTE_REQUEST_KEYWORDS = ["quote", "quotation", "quotes", "sample", "samples", "pricing", "price list", "catalogue", "catalog"];
function looksLikeQuoteRequest(subject: string, bodyText: string): boolean {
  const haystack = `${subject} ${bodyText}`.toLowerCase();
  return QUOTE_REQUEST_KEYWORDS.some((kw) => haystack.includes(kw));
}

type ReplyIntent = "opt_out" | "quote_request" | "other";

/** Mirrors apps/api/src/aiUsage.ts's soft per-org monthly AI-call cap — same
 * usage_counters table and AI_MONTHLY_CALL_LIMIT env var, so a background
 * classification call here counts against the exact same budget as a
 * template-generation call from the dashboard. Duplicated rather than
 * imported since apps/worker can't reach into apps/api's source tree (same
 * reasoning as this file's own masterKey() helper, duplicated per app). */
async function withinAiUsageLimit(db: ReturnType<typeof createAdminClient>, orgId: string): Promise<boolean> {
  const limit = Number(process.env.AI_MONTHLY_CALL_LIMIT) || 500;
  const now = new Date();
  const period = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const { data } = await db.from("usage_counters").select("count").eq("org_id", orgId).eq("period", period).eq("metric", "ai_calls");
  const used = ((data as { count: number }[] | null) ?? []).reduce((sum, row) => sum + row.count, 0);
  return used < limit;
}

async function recordAiUsage(db: ReturnType<typeof createAdminClient>, orgId: string, projectId: string, log: Logger): Promise<void> {
  try {
    const { error } = await db.rpc("increment_usage_counter", { p_org_id: orgId, p_project_id: projectId, p_period: `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, "0")}`, p_metric: "ai_calls" });
    if (error) throw error;
  } catch (err) {
    log.warn({ err, orgId, projectId }, "imap poll: failed to record AI usage counter");
  }
}

/** Strips a ```json ... ``` fence if the model wrapped its output in one —
 * same loose-parse tolerance as apps/api/src/routes/aiTemplates.ts. */
function parseJsonLoose(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return JSON.parse((fenced ? fenced[1] : text).trim());
}

/**
 * Classifies an inbound reply as an opt-out, a quotation/sample request, or
 * a plain reply — using whichever AI provider the org has connected (shared
 * across every project in the org, migration
 * 0041_connections_org_scoped.sql), ranked the same cost-aware way as
 * apps/api/src/aiRouter.ts's selectProviderAndModel (duplicated here for the
 * same cross-app reason as withinAiUsageLimit above). `projectId` is only
 * used to attribute the AI-usage counter to the reply's actual project, not
 * to find the connection. Returns null when there's no AI connection, the
 * org is over its monthly cap, or the call/parse fails for any reason — the
 * caller falls back to keyword matching in that case.
 */
async function classifyReplyIntent(
  db: ReturnType<typeof createAdminClient>,
  log: Logger,
  orgId: string,
  projectId: string,
  subject: string,
  bodyText: string
): Promise<ReplyIntent | null> {
  const { data: conns } = await db.from("provider_connections").select("*").eq("org_id", orgId).eq("kind", "ai").eq("status", "connected");
  const connections = ((conns as any[]) ?? []).map((conn) => ({
    provider: conn.provider as AiProviderId,
    credentials: JSON.parse(decryptCredentials(rowToEnvelope(conn), masterKey())) as Record<string, string>,
  }));
  if (!connections.length) return null;
  if (!(await withinAiUsageLimit(db, orgId))) return null;

  let provider: AiProviderId = connections[0]!.provider;
  let credentials = connections[0]!.credentials;
  const { data: catalog } = await db.from("ai_model_catalog").select("*");
  if (catalog?.length) {
    const candidates = buildCandidates(
      connections.map((c) => c.provider),
      (catalog as any[]).map((row) => ({
        id: row.id,
        pricingPrompt: Number(row.pricing_prompt),
        pricingCompletion: Number(row.pricing_completion),
        pricingImage: Number(row.pricing_image),
        contextLength: row.context_length,
        outputModalities: row.output_modalities ?? [],
        supportsJsonMode: row.supports_json_mode,
        qualityTier: row.quality_tier,
      })) as CatalogRow[]
    );
    const picked = pickModel("reply_classify", candidates, { prompt: Math.ceil((subject.length + bodyText.length) / 4), completion: 50 });
    if (picked) {
      const parsedId = parseCandidateId(picked.modelId);
      const conn = connections.find((c) => c.provider === parsedId.provider);
      if (conn) {
        provider = conn.provider;
        credentials = { ...conn.credentials, model: parsedId.modelId };
      }
    }
  }

  const completer = getAiCompleter(provider);
  if (!completer) return null;

  try {
    const raw = await completer(credentials, {
      system:
        'Classify an inbound email reply from a sales/outreach prospect. Respond with strict JSON only: {"intent": "opt_out" | "quote_request" | "other"}. ' +
        'Use "opt_out" if the prospect is asking to stop being contacted / unsubscribe / not interested in ever hearing again. ' +
        'Use "quote_request" if the prospect is asking for a price, quotation, quote, sample, catalogue, or similar commercial next step. ' +
        'Otherwise use "other".',
      user: `Subject: ${subject}\n\n${bodyText || "(no body text)"}`,
      maxTokens: 50,
    });
    await recordAiUsage(db, orgId, projectId, log);
    const parsed = parseJsonLoose(raw) as { intent?: string };
    if (parsed.intent === "opt_out" || parsed.intent === "quote_request" || parsed.intent === "other") return parsed.intent;
    return null;
  } catch (err) {
    log.warn({ err, projectId }, "imap poll: reply classification failed, falling back to keyword matching");
    return null;
  }
}

/**
 * Polls every project's connected IMAP reply inbox (kind "email_imap") for
 * unseen messages, matches the sender against that project's contacts, and
 * marks a reply/opt-out the same way the WhatsApp provider webhooks do —
 * there's no webhook equivalent for "someone replied to this email", so this
 * runs on the same 5-minute scheduler tick that drives everything else
 * (see apps/worker/src/index.ts), same reasoning as runSourceSyncTick.
 */
export async function runImapReplyPollTick(log: Logger): Promise<void> {
  const db = createAdminClient();
  const { data: connections, error } = await db
    .from("provider_connections")
    .select("*")
    .eq("kind", "email_imap")
    .eq("status", "connected");
  if (error) {
    log.error({ error }, "imap poll: failed to list connections");
    return;
  }

  for (const conn of (connections as any[]) ?? []) {
    try {
      await pollOneInbox(db, conn, log);
    } catch (err) {
      log.error({ err, orgId: conn.org_id }, "imap poll: failed for connection");
      await db
        .from("provider_connections")
        .update({ status: "needs_reconnect", needs_reconnect_reason: err instanceof Error ? err.message : String(err) })
        .eq("id", conn.id);
    }
  }
}

async function pollOneInbox(db: ReturnType<typeof createAdminClient>, conn: any, log: Logger): Promise<void> {
  const credentials = JSON.parse(decryptCredentials(rowToEnvelope(conn), masterKey()));
  const replies = await fetchAndConsumeUnseenImapMessages(credentials);
  if (!replies.length) return;

  // This inbox is shared across every project in the org (migration
  // 0041_connections_org_scoped.sql), so a reply is matched against
  // contacts across all of them, not just one — each contact's own
  // project_id (not conn.project_id, which no longer identifies a single
  // project) is what the rest of this function attributes the reply to.
  const { data: contacts } = await db.from("contacts").select("id, org_id, project_id, email, em_status, wa_status").eq("org_id", conn.org_id);
  const byEmail = new Map<string, any>();
  for (const c of (contacts as any[]) ?? []) {
    if (c.email) byEmail.set(String(c.email).toLowerCase(), c);
  }

  for (const reply of replies) {
    const contact = byEmail.get(reply.fromAddress);
    if (!contact) continue; // not a known lead — a newsletter, an out-of-office bounce, etc.

    // Exact-match on the subject line is a free, instant check for the
    // common literal "Subject: unsubscribe"/"STOP" case — only worth an AI
    // call (or the keyword fallback) when that doesn't already settle it.
    let intent: ReplyIntent = isOptOutText(reply.subject) ? "opt_out" : "other";
    if (intent === "other") {
      const classified = await classifyReplyIntent(db, log, contact.org_id, contact.project_id, reply.subject, reply.bodyText);
      intent = classified ?? (looksLikeQuoteRequest(reply.subject, reply.bodyText) ? "quote_request" : "other");
    }

    const contactUpdate =
      intent === "opt_out"
        ? { em_status: "opted_out", wa_status: "opted_out" }
        : intent === "quote_request"
          ? { em_status: "replied", sentiment: "Quote Requested" }
          : { em_status: "replied" };

    await db.from("message_events").insert({
      org_id: contact.org_id,
      project_id: contact.project_id,
      message_id: null,
      contact_id: contact.id,
      channel: "em",
      event_type: intent === "opt_out" ? "opted_out" : "replied",
      payload: { subject: reply.subject, intent },
    });
    await db.from("contacts").update(contactUpdate).eq("id", contact.id);
  }

  log.info({ orgId: conn.org_id, matched: replies.filter((r) => byEmail.has(r.fromAddress)).length, total: replies.length }, "imap poll: processed inbox");
}
