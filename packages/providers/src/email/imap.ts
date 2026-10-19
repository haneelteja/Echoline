import { ImapFlow } from "imapflow";
import type { ConnectionTester } from "../types";

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
        const messages = await client.fetchAll(uids, { envelope: true }, { uid: true });
        for (const message of messages) {
          const fromAddress = message.envelope?.from?.[0]?.address;
          if (fromAddress) replies.push({ fromAddress: fromAddress.toLowerCase(), subject: message.envelope?.subject ?? "" });
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
