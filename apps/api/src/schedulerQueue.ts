import { Queue } from "bullmq";
import Redis from "ioredis";

let queue: Queue | null = null;

/**
 * Producer-only: apps/api never runs a BullMQ Worker, it only enqueues jobs
 * for apps/worker's scheduler queue to pick up (the manual "Run due steps
 * now" button). A separate Redis connection from the worker's, since they're
 * different processes/deployments.
 */
export function getSchedulerQueue(): Queue {
  if (queue) return queue;
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL is not set");
  const connection = new Redis(url, { maxRetriesPerRequest: null });
  queue = new Queue("scheduler", { connection });
  return queue;
}
