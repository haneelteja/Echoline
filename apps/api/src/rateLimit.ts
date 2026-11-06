import Redis from "ioredis";
import { checkProviderRateLimit as checkProviderRateLimitShared } from "@echoline/providers";

// apps/api needs its own Redis connection for the manual "Send now" path
// (apps/worker owns a separate one for the scheduler's actual send jobs) —
// the rate-limit decision logic itself is shared, see
// packages/providers/src/rateLimit.ts.
let redis: Redis | null = null;
function getRedisConnection(): Redis {
  if (redis) return redis;
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL is not set");
  redis = new Redis(url, { maxRetriesPerRequest: null });
  return redis;
}

export async function checkProviderRateLimit(
  provider: string,
  connectionId: string,
  overridePerMinute: number | null | undefined
): Promise<{ allowed: boolean; limit: number | null }> {
  return checkProviderRateLimitShared(getRedisConnection(), provider, connectionId, overridePerMinute);
}
