export const EMAIL_PROVIDER_IDS = ["gmail", "outlook", "ses", "sendgrid", "brevo", "smtp", "resend"] as const;
export type EmailProviderId = (typeof EMAIL_PROVIDER_IDS)[number];

export const WHATSAPP_PROVIDER_IDS = ["meta", "360dialog", "gupshup", "interakt", "aisensy", "twilio", "360messenger"] as const;
export type WhatsAppProviderId = (typeof WHATSAPP_PROVIDER_IDS)[number];

/**
 * Meta, 360dialog, Gupshup, Interakt, AiSensy, and Twilio all operate on
 * official WhatsApp Business numbers, where Meta policy requires an
 * Approved template for any business-initiated ("cold") message. 360Messenger
 * is an unofficial WhatsApp-Web-automation service running on a personal
 * number — there's no template approval system at all, just free-form text,
 * so the worker skips the approval gate entirely for providers in this set.
 */
export const TEXT_ONLY_WHATSAPP_PROVIDERS = new Set<WhatsAppProviderId>(["360messenger"]);

export const AI_PROVIDER_IDS = ["anthropic", "openai", "gemini"] as const;
export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

export type ProviderId = EmailProviderId | WhatsAppProviderId | AiProviderId;

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
  /** Only meaningful alongside mediaUrls — defaults to "image". */
  mediaKind?: "image" | "document";
  /** Required by Meta for a document header; ignored for images. */
  mediaFilename?: string;
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

export interface AiCompletionRequest {
  system?: string;
  user: string;
  maxTokens?: number;
}

/** Returns the raw text completion — JSON parsing/validation is the caller's
 * job, same as the original prototype's S.sample.json() callers did. */
export type AiCompleter = (credentials: Record<string, string>, request: AiCompletionRequest) => Promise<string>;

/**
 * Only OpenAI implements this (see getEmbedder) — kb_items.embedding is a
 * fixed vector(1536) column matching text-embedding-3-small's native output
 * size exactly. Gemini's embeddings are 768-dimensional; mixing dimensions
 * in one pgvector column isn't viable, so Gemini/Anthropic connections fall
 * back to plain-text KB context instead of real similarity search.
 */
export type Embedder = (credentials: Record<string, string>, text: string) => Promise<number[]>;
