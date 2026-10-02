import type { FastifyPluginAsync } from "fastify";
import { createAdminClient } from "@echoline/db";
import { verifyOpenPixelSignature, verifyClickSignature, verifyUnsubscribeSignature } from "@echoline/providers";

// 1x1 transparent GIF, served regardless of signature validity — a tracking
// pixel must never 404 or error, or mail clients render a broken-image icon.
const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64");

function trackingConfig() {
  return { secret: process.env.TRACKING_SIGNING_SECRET ?? "", baseUrl: process.env.API_PUBLIC_URL ?? "" };
}

/**
 * Public routes hit directly by email clients (open pixel), link clicks, and
 * unsubscribe requests — never behind the /v1 auth prefix. Phase 3 wires up
 * enough to record opens/clicks/opt-outs correctly; Phase 4 builds out the
 * full provider-webhook side of delivery/bounce tracking alongside this.
 */
export const trackingRoutes: FastifyPluginAsync = async (app) => {
  app.get("/t/o/:messageId", async (req, reply) => {
    const { messageId } = req.params as { messageId: string };
    const { s } = req.query as { s?: string };
    reply.header("Content-Type", "image/gif").header("Cache-Control", "no-store");

    if (!s || !verifyOpenPixelSignature(trackingConfig(), messageId, s)) {
      return reply.send(PIXEL);
    }

    const db = createAdminClient();
    const { data: message } = await db.from("messages").select("project_id, contact_id, channel").eq("id", messageId).maybeSingle();
    if (message && (message as any).channel === "em") {
      const m = message as any;
      await db.from("contacts").update({ em_track: "opened" }).eq("id", m.contact_id).neq("em_track", "clicked");
      await db.from("message_events").insert({
        org_id: (await db.from("projects").select("org_id").eq("id", m.project_id).single()).data?.org_id,
        project_id: m.project_id,
        message_id: messageId,
        contact_id: m.contact_id,
        channel: "em",
        event_type: "opened",
      });
    }
    return reply.send(PIXEL);
  });

  app.get("/t/c/:messageId", async (req, reply) => {
    const { messageId } = req.params as { messageId: string };
    const { u, s } = req.query as { u?: string; s?: string };
    if (!u) return reply.code(400).send("Missing target URL");
    if (!s || !verifyClickSignature(trackingConfig(), messageId, u, s)) {
      // Invalid signature: still redirect (never trap the recipient on an
      // error page over a tracking technicality) but skip recording.
      return reply.redirect(u);
    }

    const db = createAdminClient();
    const { data: message } = await db.from("messages").select("project_id, contact_id, channel").eq("id", messageId).maybeSingle();
    if (message && (message as any).channel === "em") {
      const m = message as any;
      await db.from("contacts").update({ em_track: "clicked" }).eq("id", m.contact_id);
      await db.from("message_events").insert({
        org_id: (await db.from("projects").select("org_id").eq("id", m.project_id).single()).data?.org_id,
        project_id: m.project_id,
        message_id: messageId,
        contact_id: m.contact_id,
        channel: "em",
        event_type: "clicked",
        payload: { url: u },
      });
    }
    return reply.redirect(u);
  });

  async function processUnsubscribe(messageId: string, signature: string | undefined) {
    if (!signature || !verifyUnsubscribeSignature(trackingConfig(), messageId, signature)) {
      return { ok: false as const };
    }
    const db = createAdminClient();
    const { data: message } = await db.from("messages").select("project_id, contact_id, channel").eq("id", messageId).maybeSingle();
    if (!message) return { ok: false as const };
    const m = message as any;
    // Unsubscribe applies to both channels — a recipient opting out of email
    // doesn't expect to keep getting WhatsApp from the same sequence.
    await db.from("contacts").update({ em_status: "opted_out", wa_status: "opted_out" }).eq("id", m.contact_id);
    const { data: project } = await db.from("projects").select("org_id").eq("id", m.project_id).single();
    await db.from("message_events").insert({
      org_id: project?.org_id,
      project_id: m.project_id,
      message_id: messageId,
      contact_id: m.contact_id,
      channel: m.channel,
      event_type: "opted_out",
    });
    return { ok: true as const };
  }

  app.get("/u/:messageId", async (req, reply) => {
    const { messageId } = req.params as { messageId: string };
    const { s } = req.query as { s?: string };
    reply.type("text/html");
    return reply.send(`<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:480px;margin:60px auto;text-align:center">
      <h2>Unsubscribe</h2><p>Confirm you'd like to stop receiving these messages.</p>
      <form method="POST"><button type="submit" style="padding:10px 20px;font-size:15px">Confirm unsubscribe</button></form>
      </body></html>`.replace("<form method=\"POST\">", `<form method="POST" action="/u/${messageId}?s=${encodeURIComponent(s ?? "")}">`));
  });

  app.post("/u/:messageId", async (req, reply) => {
    const { messageId } = req.params as { messageId: string };
    const { s } = req.query as { s?: string };
    const result = await processUnsubscribe(messageId, s);
    reply.type("text/html");
    return reply.send(
      result.ok
        ? `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:480px;margin:60px auto;text-align:center"><h2>You're unsubscribed</h2><p>You won't receive further messages in this sequence.</p></body></html>`
        : `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:480px;margin:60px auto;text-align:center"><h2>Link expired</h2><p>This unsubscribe link is no longer valid.</p></body></html>`
    );
  });
};
