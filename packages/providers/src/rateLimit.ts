/**
 * Minimal structural interface rather than importing ioredis's own `Redis`
 * type — this package has no runtime dependency on ioredis, and doesn't
 * need one just to call two generic commands. Both apps/api's and
 * apps/worker's real ioredis clients already satisfy this shape.
 */
export interface RateLimitRedis {
  incr(key: string): Promise<number>;
  pexpire(key: string, milliseconds: number): Promise<unknown>;
}

/**
 * Per-connection send-rate cap, independent of sequence_settings.daily_cap
 * (that bounds total volume/day; this bounds burst speed/minute — a backstop
 * against tripping a provider's own abuse detection). Defaults are only set
 * where there's a specific, stated reason to be conservative: asserting a
 * real provider's documented rate limit without their docs in hand would
 * either throttle a legitimate account for no reason or just be wrong.
 * Every provider not listed here is unlimited unless
 * provider_connections.max_sends_per_minute is set explicitly.
 *
 * Shared between apps/api (the manual "Send now" path) and apps/worker (the
 * scheduler's actual send jobs) — previously duplicated verbatim in each,
 * which had already drifted out of sync once (one fixed a 0-vs-null bug
 * before the other). Each app still owns its own Redis connection; only the
 * pure decision logic lives here.
 */
export const DEFAULT_RATE_LIMITS: Partial<Record<string, number>> = {
  // Unofficial WhatsApp-Web-automation (not Meta's real Business API) —
  // sending fast enough to look automated risks the number getting flagged
  // or banned by WhatsApp itself. 10/minute is a deliberately conservative
  // starting point, not a documented limit (360Messenger publishes none).
  "360messenger": 10,
};

/**
 * Fixed 60s-window counter in Redis, keyed by connection id — simple and
 * good enough for a pacing backstop; doesn't need token-bucket precision.
 * The key embeds its own minute bucket, so a short PEXPIRE just reclaims
 * memory rather than doing anything load-bearing.
 */
export async function checkProviderRateLimit(
  redis: RateLimitRedis,
  provider: string,
  connectionId: string,
  overridePerMinute: number | null | undefined
): Promise<{ allowed: boolean; limit: number | null }> {
  const limit = overridePerMinute ?? DEFAULT_RATE_LIMITS[provider] ?? null;
  // Not `!limit` — an explicit override of 0 (set directly via SQL to pause
  // a connection entirely) is falsy and would otherwise read as "no limit."
  if (limit === null) return { allowed: true, limit: null };
  const key = `ratelimit:send:${connectionId}:${Math.floor(Date.now() / 60_000)}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.pexpire(key, 120_000);
  return { allowed: count <= limit, limit };
}
