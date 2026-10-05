// Status machine — names match docs/DATA_MODEL.md exactly. Do not rename without
// updating the DB enum `contact_channel_status` and every consumer.

export const CHANNEL_KEYS = ["em", "wa"] as const;
export type ChannelKey = (typeof CHANNEL_KEYS)[number];

export const STAGE_STATUS_KEYS = [
  "not_contacted",
  "initial_sent",
  "fu1_sent",
  "fu2_sent",
  "completed",
] as const;
export type StageStatus = (typeof STAGE_STATUS_KEYS)[number];

export const TERMINAL_STATUSES = {
  replied: "Replied",
  opted_out: "Opted out",
  invalid: "Invalid contact",
  bounced: "Bounced",
  failed: "Failed",
} as const;
export type TerminalStatus = keyof typeof TERMINAL_STATUSES;

export type ContactChannelStatus = StageStatus | TerminalStatus;

export const STAGE_LABEL: Record<StageStatus, string> = {
  not_contacted: "Not contacted",
  initial_sent: "Initial sent",
  fu1_sent: "Follow-up 1 sent",
  fu2_sent: "Follow-up 2 sent",
  completed: "All steps sent",
};

export function isTerminal(status: ContactChannelStatus): status is TerminalStatus {
  return status in TERMINAL_STATUSES;
}

export function statusLabel(status: ContactChannelStatus): string {
  if (isTerminal(status)) return TERMINAL_STATUSES[status];
  return STAGE_LABEL[status as StageStatus] ?? status;
}

// "Response or Sentiment" — a manually-set sales-pipeline stage, distinct
// from em_status/wa_status (which track automated sequence progress). Plain
// text column (not a DB enum) so this list can grow without a migration —
// validated against this list at the app layer instead.
export const SENTIMENT_VALUES = [
  "Not Contacted",
  "Contacted",
  "Cold Call Done",
  "Interested",
  "Offer Made",
  "Converted",
  "Not Interested",
  "Lost",
] as const;
export type Sentiment = (typeof SENTIMENT_VALUES)[number];

// Email delivery tracking: sent | opened | clicked | bounced
export const EMAIL_TRACK_VALUES = ["sent", "opened", "clicked", "bounced"] as const;
export type EmailTrack = (typeof EMAIL_TRACK_VALUES)[number];

// WhatsApp delivery tracking: delivered | read | failed
export const WHATSAPP_TRACK_VALUES = ["delivered", "read", "failed"] as const;
export type WhatsAppTrack = (typeof WHATSAPP_TRACK_VALUES)[number];
