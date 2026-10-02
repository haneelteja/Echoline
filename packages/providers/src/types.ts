export const EMAIL_PROVIDER_IDS = ["gmail", "outlook", "ses", "sendgrid", "brevo", "smtp"] as const;
export type EmailProviderId = (typeof EMAIL_PROVIDER_IDS)[number];

export const WHATSAPP_PROVIDER_IDS = ["meta", "360dialog", "gupshup", "interakt", "aisensy", "twilio"] as const;
export type WhatsAppProviderId = (typeof WHATSAPP_PROVIDER_IDS)[number];

export type ProviderId = EmailProviderId | WhatsAppProviderId;

export interface ConnectionTestResult {
  ok: boolean;
  accountLabel?: string;
  error?: string;
}

/**
 * Validates that a set of credentials actually works against the provider,
 * without sending anything. Credentials are plain JS objects here — the
 * encrypted-at-rest handling lives entirely in packages/db's vault and
 * apps/api's connections routes; testers never see ciphertext.
 */
export type ConnectionTester = (credentials: Record<string, string>) => Promise<ConnectionTestResult>;
