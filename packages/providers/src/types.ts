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

export interface SendResult {
  providerMessageId: string;
}

export interface EmailMessage {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  /** e.g. List-Unsubscribe / List-Unsubscribe-Post */
  headers?: Record<string, string>;
}

export type EmailSender = (credentials: Record<string, string>, message: EmailMessage) => Promise<SendResult>;

export interface WhatsAppTemplateComponent {
  type: "header" | "body" | "button";
  parameters: { type: "text" | "image" | "video" | "document"; text?: string; link?: string }[];
}

export interface WhatsAppTemplateMessage {
  to: string;
  templateName: string;
  language: string;
  components?: WhatsAppTemplateComponent[];
  mediaUrls?: string[];
}

export interface WhatsAppTextMessage {
  to: string;
  text: string;
}

export type WhatsAppTemplateSender = (
  credentials: Record<string, string>,
  message: WhatsAppTemplateMessage
) => Promise<SendResult>;

/** Only valid within the 24-hour customer-service window — enforced by the
 * caller (the worker), not by the adapter itself. */
export type WhatsAppTextSender = (credentials: Record<string, string>, message: WhatsAppTextMessage) => Promise<SendResult>;
