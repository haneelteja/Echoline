import { createServer } from "node:http";

/**
 * Render's free plan only runs Web Services, which get spun down after 15 min
 * with no inbound HTTP traffic — unlike Background Workers (Starter plan and
 * up), which stay alive with no traffic at all. To run this BullMQ consumer
 * on the free plan, it binds a port and answers health checks like a web
 * service; an external uptime pinger (UptimeRobot/cron-job.org) hits it more
 * often than the 15-min idle window so the process — and the BullMQ workers
 * running inside it — never stops.
 */
export function startHealthServer() {
  const port = Number(process.env.PORT) || 10000;
  const server = createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
  });
  server.listen(port);
  return server;
}
