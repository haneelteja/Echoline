import { createAdminClient, decryptCredentials, loadMasterKey, rowToEnvelope } from "@echoline/db";
import { fetchMetaPhoneQuality } from "@echoline/providers";
import type { Logger } from "pino";

function masterKey() {
  return loadMasterKey(process.env.CREDENTIAL_VAULT_MASTER_KEY);
}

const DAY_MS = 24 * 60 * 60 * 1000;

function isDue(checkedAt: string | null): boolean {
  if (!checkedAt) return true;
  return Date.now() - new Date(checkedAt).getTime() >= DAY_MS;
}

/**
 * Daily backstop for Meta phone number quality_rating/messaging_limit_tier —
 * the phone_number_quality_update webhook (apps/api/src/routes/webhooks.ts)
 * already refreshes this on every event Meta actually sends, but webhooks can
 * be missed (an outage, a misconfigured subscription, a number that simply
 * never triggers one), so this rides the same 5-minute scheduler tick as
 * source sync/IMAP poll and only actually hits the Graph API once per
 * connection per 24h (isDue(), same pattern as sourceSync's own per-source
 * cadence). Meta-only — see the migration's comment for why 360dialog/Twilio
 * aren't included.
 */
export async function runWaQualityPollTick(log: Logger): Promise<void> {
  const db = createAdminClient();
  const { data: connections, error } = await db
    .from("provider_connections")
    .select("id, project_id, wa_quality_checked_at, encrypted_credentials, encryption_iv, encryption_tag, encrypted_dek, dek_iv, dek_tag")
    .eq("kind", "whatsapp")
    .eq("provider", "meta")
    .eq("status", "connected");
  if (error) {
    log.error({ error }, "wa quality poll: failed to list connections");
    return;
  }

  for (const conn of (connections as any[]) ?? []) {
    if (!isDue(conn.wa_quality_checked_at)) continue;
    try {
      const credentials = JSON.parse(decryptCredentials(rowToEnvelope(conn), masterKey()));
      const quality = await fetchMetaPhoneQuality(credentials);
      await db
        .from("provider_connections")
        .update({ wa_quality_rating: quality.qualityRating, wa_messaging_tier: quality.messagingLimitTier, wa_quality_checked_at: new Date().toISOString() })
        .eq("id", conn.id);
      log.info({ connId: conn.id, ...quality }, "wa quality poll: refreshed");
    } catch (err) {
      // Not treated as a reconnect-worthy failure (unlike IMAP/source sync) —
      // a transient Graph API hiccup shouldn't flip a perfectly good sending
      // connection to needs_reconnect; just retry on the next due cycle.
      log.error({ err, connId: conn.id }, "wa quality poll: failed for connection");
    }
  }
}
