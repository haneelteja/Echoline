import Fastify, { type FastifyError } from "fastify";
import cors from "@fastify/cors";
import { requireAuth } from "./auth.js";
import { projectRoutes } from "./routes/projects.js";
import { settingsRoutes } from "./routes/settings.js";
import { collectionRoutes } from "./routes/collections.js";
import { connectionRoutes } from "./routes/connections.js";
import { oauthCallbackRoutes } from "./routes/oauthCallback.js";
import { trackingRoutes } from "./routes/tracking.js";

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
    transport: process.env.NODE_ENV === "production" ? undefined : { target: "pino-pretty" },
  },
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

await app.register(
  async (api) => {
    api.addHook("preHandler", requireAuth);
    await api.register(projectRoutes);
    await api.register(settingsRoutes);
    await api.register(collectionRoutes);
    await api.register(connectionRoutes);
  },
  { prefix: "/v1" }
);

app.setErrorHandler((err: FastifyError, req, reply) => {
  req.log.error(err);
  if (err.validation) {
    return reply.code(400).send({ error: "validation_error", message: err.message });
  }
  return reply.code(err.statusCode ?? 500).send({ error: "internal_error", message: err.message });
});

const port = Number(process.env.PORT ?? 4000);
app
  .listen({ port, host: "0.0.0.0" })
  .then(() => app.log.info(`Echoline API listening on :${port}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
