import { createAdminClient } from "@echoline/db";

const DEFAULT_MONTHLY_LIMIT = 500;

function monthlyLimit(): number {
  const raw = process.env.AI_MONTHLY_CALL_LIMIT;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MONTHLY_LIMIT;
}

function currentPeriod(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Per-org monthly cap on AI template-generation/rewrite/insights calls, to
 * bound per-org OpenRouter/Anthropic/OpenAI/Gemini spend until real
 * billing/plan tiers exist (packages/db's `plans`/`subscriptions` tables are
 * still unused Phase-8 stubs). One shared limit for every org via
 * AI_MONTHLY_CALL_LIMIT — not yet configurable per org/plan.
 *
 * Usage is summed across every project in the org, reusing the existing
 * usage_counters(org_id, project_id, period, metric) shape rather than a
 * separate org-level row with project_id null — Postgres doesn't enforce
 * uniqueness across NULLs, so concurrent requests could otherwise create
 * duplicate rows for the same org/period/metric.
 *
 * This is a soft cap, not a hard lock: the check and the increment
 * (recordAiUsage, called only after a successful AI response) are two
 * separate round trips, so a burst of concurrent requests right at the
 * boundary could let a few over. Acceptable for a cost-control guardrail,
 * not something relied on for billing accuracy.
 */
export async function checkAiUsageLimit(orgId: string): Promise<{ ok: true } | { ok: false; limit: number; used: number }> {
  const db = createAdminClient();
  const { data } = await db.from("usage_counters").select("count").eq("org_id", orgId).eq("period", currentPeriod()).eq("metric", "ai_calls");
  const used = ((data as { count: number }[] | null) ?? []).reduce((sum, row) => sum + row.count, 0);
  const limit = monthlyLimit();
  return used >= limit ? { ok: false, limit, used } : { ok: true };
}

/** Best-effort — a failure here shouldn't undo an AI call that already
 * succeeded and was returned to the caller; it just means this one call is
 * undercounted. */
export async function recordAiUsage(orgId: string, projectId: string, log: { warn: (obj: unknown, msg: string) => void }): Promise<void> {
  try {
    const db = createAdminClient();
    const { error } = await db.rpc("increment_usage_counter", {
      p_org_id: orgId,
      p_project_id: projectId,
      p_period: currentPeriod(),
      p_metric: "ai_calls",
    });
    if (error) throw error;
  } catch (err) {
    log.warn({ err, orgId, projectId }, "failed to record AI usage counter");
  }
}
