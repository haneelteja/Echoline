import { createAdminClient, decryptCredentials, loadMasterKey, rowToEnvelope } from "@echoline/db";
import { fetchOpenRouterCatalog, type OpenRouterCatalogEntry } from "@echoline/providers";
import type { Logger } from "pino";
import { getRedisConnection } from "./redis.js";

const CATALOG_CACHE_KEY = "ai_model_catalog:v1";

function masterKey() {
  return loadMasterKey(process.env.CREDENTIAL_VAULT_MASTER_KEY);
}

const DAY_MS = 24 * 60 * 60 * 1000;

function toRow(entry: OpenRouterCatalogEntry) {
  return {
    id: entry.id,
    name: entry.name,
    pricing_prompt: entry.pricingPrompt,
    pricing_completion: entry.pricingCompletion,
    pricing_image: entry.pricingImage,
    context_length: entry.contextLength,
    output_modalities: entry.outputModalities,
    supports_json_mode: entry.supportsJsonMode,
    quality_tier: entry.qualityTier,
    fetched_at: new Date().toISOString(),
  };
}

/**
 * Refreshes ai_model_catalog (the intelligent AI router's cost/capability
 * data — see apps/api/src/aiRouter.ts, packages/providers/src/router/*).
 * Rides the existing 5-minute scheduler tick, same as source
 * sync/IMAP/WA-quality polling, but only actually hits OpenRouter when the
 * cached catalog is stale (>24h old) or empty — the model catalog doesn't
 * change minute to minute. Not project-specific: any project's connected
 * OpenRouter credentials work, since the catalog itself is the same for
 * every tenant.
 */
export async function runAiCatalogSyncTick(log: Logger): Promise<void> {
  const db = createAdminClient();
  const { data: newest } = await db.from("ai_model_catalog").select("fetched_at").order("fetched_at", { ascending: false }).limit(1).maybeSingle();
  const freshest = (newest as { fetched_at: string } | null)?.fetched_at ?? null;
  if (freshest && Date.now() - new Date(freshest).getTime() < DAY_MS) return;

  const { data: conn } = await db
    .from("provider_connections")
    .select("encrypted_credentials, encryption_iv, encryption_tag, encrypted_dek, dek_iv, dek_tag")
    .eq("kind", "ai")
    .eq("provider", "openrouter")
    .eq("status", "connected")
    .limit(1)
    .maybeSingle();
  if (!conn) return; // no connected OpenRouter project anywhere — nothing to refresh with yet

  try {
    const credentials = JSON.parse(decryptCredentials(rowToEnvelope(conn as any), masterKey()));
    const entries = await fetchOpenRouterCatalog(credentials.apiKey);
    if (!entries.length) return;
    // Full replace, not an incremental upsert — a model OpenRouter removed
    // (deprecated, renamed, or excluded by a new filter like :batch) must
    // disappear from the catalog too, or the router can keep picking a
    // stale id forever. Confirmed live, 2026-11-06: an earlier upsert-only
    // version left already-excluded :batch rows sitting in the table.
    const { error: deleteErr } = await db.from("ai_model_catalog").delete().not("id", "is", null);
    if (deleteErr) throw deleteErr;
    const { error } = await db.from("ai_model_catalog").insert(entries.map(toRow));
    if (error) throw error;
    // Invalidate the Redis cache (apps/api/src/aiRouter.ts and this file's
    // own imapPoll.ts both read through it) so the refresh is visible
    // immediately instead of waiting out its TTL.
    await getRedisConnection()
      .del(CATALOG_CACHE_KEY)
      .catch((err) => log.warn({ err }, "ai catalog sync: failed to invalidate cache"));
    log.info({ count: entries.length }, "ai catalog sync: refreshed");
  } catch (err) {
    // Not reconnect-worthy — a transient OpenRouter hiccup just means the
    // router keeps using whatever catalog (possibly stale, possibly empty)
    // it already had; retried on the next due cycle.
    log.error({ err }, "ai catalog sync: failed");
  }
}
