import Redis from "ioredis";

let connection: Redis | null = null;

/** BullMQ requires maxRetriesPerRequest: null on the shared connection. */
export function getRedisConnection(): Redis {
  if (connection) return connection;
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL is not set");
  connection = new Redis(url, { maxRetriesPerRequest: null });
  return connection;
}
