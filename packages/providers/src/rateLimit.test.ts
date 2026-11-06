import { describe, expect, it } from "vitest";
import { checkProviderRateLimit, type RateLimitRedis } from "./rateLimit";

function fakeRedis(): RateLimitRedis & { store: Map<string, number> } {
  const store = new Map<string, number>();
  return {
    store,
    async incr(key: string) {
      const next = (store.get(key) ?? 0) + 1;
      store.set(key, next);
      return next;
    },
    async pexpire() {
      return 1;
    },
  };
}

describe("checkProviderRateLimit", () => {
  it("is unlimited when no override and no default exists for the provider", async () => {
    const result = await checkProviderRateLimit(fakeRedis(), "resend", "conn-1", null);
    expect(result).toEqual({ allowed: true, limit: null });
  });

  it("applies the provider default (360messenger: 10/min) when no override is set", async () => {
    const redis = fakeRedis();
    for (let i = 0; i < 10; i++) {
      const result = await checkProviderRateLimit(redis, "360messenger", "conn-1", undefined);
      expect(result.allowed).toBe(true);
    }
    const eleventh = await checkProviderRateLimit(redis, "360messenger", "conn-1", undefined);
    expect(eleventh).toEqual({ allowed: false, limit: 10 });
  });

  it("an explicit override of 0 blocks every send, not treated as unlimited", async () => {
    const result = await checkProviderRateLimit(fakeRedis(), "resend", "conn-1", 0);
    expect(result).toEqual({ allowed: false, limit: 0 });
  });

  it("an explicit override replaces the provider default", async () => {
    const redis = fakeRedis();
    const first = await checkProviderRateLimit(redis, "360messenger", "conn-1", 1);
    expect(first).toEqual({ allowed: true, limit: 1 });
    const second = await checkProviderRateLimit(redis, "360messenger", "conn-1", 1);
    expect(second).toEqual({ allowed: false, limit: 1 });
  });

  it("isolates the counter per connection id", async () => {
    const redis = fakeRedis();
    await checkProviderRateLimit(redis, "360messenger", "conn-a", 1);
    const connB = await checkProviderRateLimit(redis, "360messenger", "conn-b", 1);
    expect(connB.allowed).toBe(true);
  });
});
