import Fastify, { type FastifyError } from "fastify";
import cors from "@fastify/cors";
import { initSentry, captureException } from "./sentry.js";
import { requireAuth } from "./auth.js";
import { projectRoutes } from "./routes/projects.js";
import { settingsRoutes } from "./routes/settings.js";
import { collectionRoutes } from "./routes/collections.js";
import { connectionRoutes } from "./routes/connections.js";
import { waTemplatesRoutes } from "./routes/waTemplates.js";
import { aiTemplatesRoutes } from "./routes/aiTemplates.js";
import { activityRoutes } from "./routes/activity.js";
import { oauthCallbackRoutes } from "./routes/oauthCallback.js";
import { trackingRoutes } from "./routes/tracking.js";
import { webhookRoutes } from "./routes/webhooks.js";
import { intakeRoutes } from "./routes/intake.js";
import { sourcesRoutes } from "./routes/sources.js";

initSentry();

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
    transport: process.env.NODE_ENV === "production" ? undefined : { target: "pino-pretty" },
  },
});

// Provider webhook signatures (Resend/SendGrid/Meta) are computed over the
// exact raw request bytes — Fastify's default JSON parser doesn't retain
// those, so this override stashes them on req.rawBody before parsing. Also
// adds application/x-www-form-urlencoded support (Twilio's webhook format),
// which nothing else in this app previously needed.
app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
  (req as unknown as { rawBody: string }).rawBody = body as string;
  if (!body) return done(null, {});
  try {
    done(null, JSON.parse(body as string));
  } catch (err) {
    done(err as Error, undefined);
  }
});
app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (req, body, done) => {
  (req as unknown as { rawBody: string }).rawBody = body as string;
  done(null, Object.fromEntries(new URLSearchParams(body as string)));
});
// AWS SNS (SES's bounce/complaint/delivery notifications) POSTs its JSON
// body with Content-Type: text/plain, not application/json — a well-known
// AWS quirk, not a bug on the sending side.
app.addContentTypeParser("text/plain", { parseAs: "string" }, (req, body, done) => {
  (req as unknown as { rawBody: string }).rawBody = body as string;
  if (!body) return done(null, {});
  try {
    done(null, JSON.parse(body as string));
  } catch (err) {
    done(err as Error, undefined);
  }
});

const allowedOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:3000")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
await app.register(cors, { origin: allowedOrigins });

app.get("/health", async () => ({ ok: true }));

// Public: hit directly by the browser's redirect from Google/Microsoft, never
// by our own authenticated fetch client. Must stay outside the /v1 group.
await app.register(oauthCallbackRoutes);
await app.register(trackingRoutes);
await app.register(webhookRoutes);
await app.register(intakeRoutes);

await app.register(
  async (api) => {
    api.addHook("preHandler", requireAuth);
    await api.register(projectRoutes);
    await api.register(settingsRoutes);
    await api.register(collectionRoutes);
    await api.register(connectionRoutes);
    await api.register(sourcesRoutes);
    await api.register(waTemplatesRoutes);
    await api.register(aiTemplatesRoutes);
    await api.register(activityRoutes);
  },
  { prefix: "/v1" }
);

app.setErrorHandler((err: FastifyError, req, reply) => {
  req.log.error(err);
  if (err.validation) {
    return reply.code(400).send({ error: "validation_error", message: err.message });
  }
  // Only unexpected (5xx) errors go to Sentry — a bad request isn't a bug to page anyone about.
  if (!err.statusCode || err.statusCode >= 500) captureException(err);
  return reply.code(err.statusCode ?? 500).send({ error: "internal_error", message: err.message });
});

process.on("unhandledRejection", (err) => {
  captureException(err);
  app.log.error(err, "unhandled rejection");
});

const port = Number(process.env.PORT ?? 4000);
app
  .listen({ port, host: "0.0.0.0" })
  .then(() => app.log.info(`Echoline API listening on :${port}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
