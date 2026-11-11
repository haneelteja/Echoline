import * as Sentry from "@sentry/node";
import { ZodError } from "zod";

/** No-op when SENTRY_DSN is unset — error capture is opt-in, not a hard dependency. */
export function initSentry() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    tracesSampleRate: 0,
    // Sentry's automatic Fastify instrumentation captures every error thrown
    // inside a route handler the moment it's thrown (mechanism:
    // "auto.function.fastify", handled: false) — before app.ts's own
    // setErrorHandler gets a chance to turn a ZodError/ajv validation error
    // into a clean 400. That duplicates (and bypasses) the app's own "only
    // 5xx pages anyone" policy there. Confirmed live, 2026-11-11: a user
    // typing an invalid invite email paged the team as a "high priority"
    // issue despite the API correctly responding 400 validation_error.
    beforeSend(event, hint) {
      const err = hint.originalException;
      if (err instanceof ZodError) return null;
      if (err && typeof err === "object" && "validation" in err && (err as { validation?: unknown }).validation) return null;
      return event;
    },
  });
}

export function captureException(err: unknown) {
  if (process.env.SENTRY_DSN) Sentry.captureException(err);
}
