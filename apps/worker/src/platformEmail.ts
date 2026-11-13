import { getEmailSender } from "@echoline/providers";

/**
 * The platform's own transactional email — same credential/shape as
 * apps/api/src/platformEmail.ts, duplicated here because apps/worker can't
 * import from apps/api's source tree (same cross-app reasoning as this
 * repo's other small duplicated helpers, e.g. masterKey()). Used by
 * reportSend.ts's scheduled report emails.
 */
export interface PlatformEmailAttachment {
  filename: string;
  /** Base64-encoded — matches @echoline/providers' EmailAttachment shape. */
  content: string;
  contentType: string;
}

export async function sendPlatformEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: PlatformEmailAttachment[];
}): Promise<void> {
  const apiKey = process.env.PLATFORM_RESEND_API_KEY;
  const from = process.env.PLATFORM_EMAIL_FROM;
  if (!apiKey || !from) throw new Error("Platform email isn't configured (PLATFORM_RESEND_API_KEY/PLATFORM_EMAIL_FROM)");
  const sender = getEmailSender("resend");
  if (!sender) throw new Error("Resend sender not available");
  await sender({ apiKey }, { from, to: opts.to, subject: opts.subject, html: opts.html, text: opts.text, attachments: opts.attachments });
}
