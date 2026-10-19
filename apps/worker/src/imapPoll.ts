import { createAdminClient, decryptCredentials, loadMasterKey, rowToEnvelope } from "@echoline/db";
import { fetchAndConsumeUnseenImapMessages } from "@echoline/providers";
import type { Logger } from "pino";

function masterKey() {
  return loadMasterKey(process.env.CREDENTIAL_VAULT_MASTER_KEY);
}

const OPT_OUT_KEYWORDS = new Set(["stop", "unsubscribe", "cancel", "end", "quit", "opt out", "optout"]);
function isOptOutText(text: string): boolean {
  return OPT_OUT_KEYWORDS.has(text.trim().toLowerCase());
}

/**
 * Polls every project's connected IMAP reply inbox (kind "email_imap") for
 * unseen messages, matches the sender against that project's contacts, and
 * marks a reply/opt-out the same way the WhatsApp provider webhooks do —
 * there's no webhook equivalent for "someone replied to this email", so this
 * runs on the same 5-minute scheduler tick that drives everything else
 * (see apps/worker/src/index.ts), same reasoning as runSourceSyncTick.
 */
export async function runImapReplyPollTick(log: Logger): Promise<void> {
  const db = createAdminClient();
  const { data: connections, error } = await db
    .from("provider_connections")
    .select("*")
    .eq("kind", "email_imap")
    .eq("status", "connected");
  if (error) {
    log.error({ error }, "imap poll: failed to list connections");
    return;
  }

  for (const conn of (connections as any[]) ?? []) {
    try {
      await pollOneInbox(db, conn, log);
    } catch (err) {
      log.error({ err, projectId: conn.project_id }, "imap poll: failed for connection");
      await db
        .from("provider_connections")
        .update({ status: "needs_reconnect", needs_reconnect_reason: err instanceof Error ? err.message : String(err) })
        .eq("id", conn.id);
    }
  }
}

async function pollOneInbox(db: ReturnType<typeof createAdminClient>, conn: any, log: Logger): Promise<void> {
  const credentials = JSON.parse(decryptCredentials(rowToEnvelope(conn), masterKey()));
  const replies = await fetchAndConsumeUnseenImapMessages(credentials);
  if (!replies.length) return;

  const { data: contacts } = await db.from("contacts").select("id, org_id, email, em_status, wa_status").eq("project_id", conn.project_id);
  const byEmail = new Map<string, any>();
  for (const c of (contacts as any[]) ?? []) {
    if (c.email) byEmail.set(String(c.email).toLowerCase(), c);
  }

  for (const reply of replies) {
    const contact = byEmail.get(reply.fromAddress);
    if (!contact) continue; // not a known lead — a newsletter, an out-of-office bounce, etc.

    const isOptOut = isOptOutText(reply.subject);
    const contactUpdate = isOptOut ? { em_status: "opted_out", wa_status: "opted_out" } : { em_status: "replied" };

    await db.from("message_events").insert({
      org_id: contact.org_id,
      project_id: conn.project_id,
      message_id: null,
      contact_id: contact.id,
      channel: "em",
      event_type: isOptOut ? "opted_out" : "replied",
      payload: { subject: reply.subject },
    });
    await db.from("contacts").update(contactUpdate).eq("id", contact.id);
  }

  log.info({ projectId: conn.project_id, matched: replies.filter((r) => byEmail.has(r.fromAddress)).length, total: replies.length }, "imap poll: processed inbox");
}
