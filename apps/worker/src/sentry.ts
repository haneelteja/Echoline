import * as Sentry from "@sentry/node";
import type { Job } from "bullmq";

/** No-op when SENTRY_DSN is unset — error capture is opt-in, not a hard dependency. */
export function initSentry() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({ dsn, environment: process.env.NODE_ENV ?? "development", tracesSampleRate: 0 });
}

export function captureException(err: unknown) {
  if (process.env.SENTRY_DSN) Sentry.captureException(err);
}

/** Only reports once a job has exhausted all its retries — every individual
 * retry attempt also fires "failed", and paging on each would be noise. */
export function reportIfExhausted(job: Job | undefined, err: Error) {
  if (!job) return;
  const isLastAttempt = job.attemptsMade >= (job.opts.attempts ?? 1);
  if (isLastAttempt) captureException(err);
}
