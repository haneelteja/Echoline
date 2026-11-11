import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type { ConnectionTester } from "../types";

/** Crude tag-stripping fallback for HTML-only replies (no text/plain part) —
 * good enough for intent classification, not meant to render. */
function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const MAX_BODY_CHARS = 4000;

function buildClient(credentials: Record<string, string>): ImapFlow {
  const { host, port, user, pass } = credentials;
  if (!host || !port || !user || !pass) throw new Error("host, port, user and pass are required");
  const secure = credentials.secure !== "false"; // default true (993) — most IMAP hosts are TLS-only
  return new ImapFlow({ host, port: Number(port), secure, auth: { user, pass }, logger: false });
}

export const testImap: ConnectionTester = async (credentials) => {
  let client: ImapFlow;
  try {
    client = buildClient(credentials);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  try {
    await client.connect();
    await client.logout();
    return { ok: true, accountLabel: credentials.user };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "IMAP connection failed" };
  }
};

export interface ImapReply {
  fromAddress: string;
  subject: string;
  /** Plain-text body (HTML-stripped fallback if no text/plain part), capped
   * at MAX_BODY_CHARS — only used for reply-intent classification, not display. */
  bodyText: string;
}

/**
 * Fetches and consumes every unseen message currently in the inbox — each
 * one gets marked \Seen whether or not it matched a known contact, so a
 * newsletter or unrelated email sitting in the same inbox doesn't get
 * re-fetched and re-evaluated on every poll forever. Caller (apps/worker)
 * does the contact matching and status updates; this only reads the mailbox.
 */
export async function fetchAndConsumeUnseenImapMessages(credentials: Record<string, string>): Promise<ImapReply[]> {
  const client = buildClient(credentials);
  await client.connect();
  const replies: ImapReply[] = [];
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const uids = await client.search({ seen: false }, { uid: true });
      if (uids && uids.length) {
        const messages = await client.fetchAll(uids, { envelope: true, source: true }, { uid: true });
        for (const message of messages) {
          const fromAddress = message.envelope?.from?.[0]?.address;
          if (!fromAddress) continue;
          let bodyText = "";
          if (message.source) {
            try {
              const parsed = await simpleParser(message.source);
              bodyText = (parsed.text || (parsed.html ? htmlToPlainText(parsed.html) : "")).slice(0, MAX_BODY_CHARS);
            } catch {
              // Malformed MIME — still worth recording the reply itself,
              // just without body text to classify intent from.
            }
          }
          replies.push({ fromAddress: fromAddress.toLowerCase(), subject: message.envelope?.subject ?? "", bodyText });
        }
        await client.messageFlagsAdd(uids, ["\\Seen"], { uid: true });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
  return replies;
}
