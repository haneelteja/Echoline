import pino from "pino";
import { Worker, type Job } from "bullmq";
import { initSentry, reportIfExhausted } from "./sentry.js";
import { getRedisConnection } from "./redis.js";
import { getSchedulerQueue, SCHEDULER_QUEUE } from "./queues.js";
import { runSchedulerForProject, runSchedulerTick } from "./scheduler.js";
import { runSourceSyncTick, syncSourceNow } from "./sourceSync.js";
import { startEmailWorker } from "./workers/emailWorker.js";
import { startWhatsAppWorker } from "./workers/whatsappWorker.js";
import { startHealthServer } from "./healthServer.js";

const log = pino({
  name: "echoline-worker",
  level: process.env.LOG_LEVEL ?? "info",
  transport: process.env.NODE_ENV === "production" ? undefined : { target: "pino-pretty" },
});

const FIVE_MINUTES_MS = 5 * 60 * 1000;

async function main() {
  initSentry();
  const healthServer = startHealthServer();
  const schedulerQueue = getSchedulerQueue();
  // Re-adding an identical repeatable job on every restart is a no-op in
  // BullMQ (deduped by jobId + repeat pattern), so this is safe to call here.
  // removeOnComplete/removeOnFail bound its history — unlike the send jobs
  // and manual triggers (which already cap retention), this repeatable job
  // had no cap at all, so its completed/failed run history would otherwise
  // accumulate unbounded against the 30MB Redis Cloud free tier.
  await schedulerQueue.add(
    "tick",
    {},
    { repeat: { every: FIVE_MINUTES_MS }, jobId: "scheduler-tick", removeOnComplete: 50, removeOnFail: 50 }
  );

  const schedulerWorker = new Worker(
    SCHEDULER_QUEUE,
    async (job: Job<{ projectId?: string; sourceId?: string }>) => {
      if (job.data?.sourceId) {
        // Manual "Sync now" trigger from apps/api, scoped to one lead source.
        await syncSourceNow(job.data.sourceId, log);
        log.info({ sourceId: job.data.sourceId }, "manual source sync trigger processed");
      } else if (job.data?.projectId) {
        // Manual "Run due steps now" trigger from apps/api, scoped to one project.
        const result = await runSchedulerForProject(job.data.projectId, log);
        log.info({ projectId: job.data.projectId, ...result }, "manual run-due trigger processed");
      } else {
        await runSchedulerTick(log);
        // Lead-source sync rides the same 5-minute tick; isDue() inside
        // governs actual per-source cadence (15 min/Hourly/Daily), and a
        // sync failure shouldn't fail the whole scheduler job.
        await runSourceSyncTick(log).catch((err) => log.error({ err }, "source sync tick failed"));
      }
    },
    { connection: getRedisConnection() }
  );
  schedulerWorker.on("failed", (job, err) => {
    log.error({ jobId: job?.id, err }, "scheduler tick failed");
    reportIfExhausted(job, err);
  });

  const emailWorker = startEmailWorker();
  const whatsappWorker = startWhatsAppWorker();

  log.info("Echoline worker started: scheduler (every 5 min) + source sync + send-email + send-whatsapp");

  const shutdown = async () => {
    log.info("Shutting down...");
    await Promise.all([schedulerWorker.close(), emailWorker.close(), whatsappWorker.close(), schedulerQueue.close()]);
    healthServer.close();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  log.error(err, "worker failed to start");
  process.exit(1);
});
