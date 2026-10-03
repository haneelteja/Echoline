import * as Sentry from "@sentry/node";

/** No-op when SENTRY_DSN is unset — error capture is opt-in, not a hard dependency. */
export function initSentry() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({ dsn, environment: process.env.NODE_ENV ?? "development", tracesSampleRate: 0 });
}

export function captureException(err: unknown) {
  if (process.env.SENTRY_DSN) Sentry.captureException(err);
}
