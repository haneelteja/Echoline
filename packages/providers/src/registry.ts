import type { AiCompleter, AiProviderId, ConnectionTester, EmailProviderId, EmailSender, ProviderId, WhatsAppProviderId, WhatsAppTemplateSender, WhatsAppTextSender } from "./types";
import { testGmail, sendGmail } from "./email/gmail";
import { testOutlook, sendOutlook } from "./email/outlook";
import { testSes, sendSes } from "./email/ses";
import { testSendGrid, sendSendGrid } from "./email/sendgrid";
import { testBrevo, sendBrevo } from "./email/brevo";
import { testSmtp, sendSmtp } from "./email/smtp";
import { testResend, sendResend } from "./email/resend";
import { testMeta, sendMetaTemplate, sendMetaText } from "./whatsapp/meta";
import { test360Dialog, send360DialogTemplate } from "./whatsapp/360dialog";
import { testGupshup, sendGupshupTemplate } from "./whatsapp/gupshup";
import { testInterakt, sendInteraktTemplate } from "./whatsapp/interakt";
import { testAiSensy, sendAiSensyTemplate } from "./whatsapp/aisensy";
import { testTwilio, sendTwilioTemplate, sendTwilioText } from "./whatsapp/twilio";
import { test360Messenger, send360MessengerText } from "./whatsapp/360messenger";
import { testAnthropic, completeAnthropic } from "./ai/anthropic";
import { testOpenAi, completeOpenAi } from "./ai/openai";
import { testGemini, completeGemini } from "./ai/gemini";

export const connectionTesters: Record<ProviderId, ConnectionTester> = {
  gmail: testGmail,
  outlook: testOutlook,
  ses: testSes,
  sendgrid: testSendGrid,
  brevo: testBrevo,
  smtp: testSmtp,
  resend: testResend,
  meta: testMeta,
  "360dialog": test360Dialog,
  gupshup: testGupshup,
  interakt: testInterakt,
  aisensy: testAiSensy,
  twilio: testTwilio,
  "360messenger": test360Messenger,
  anthropic: testAnthropic,
  openai: testOpenAi,
  gemini: testGemini,
};

export function getConnectionTester(providerId: string): ConnectionTester | undefined {
  return connectionTesters[providerId as ProviderId];
}

export const emailSenders: Record<EmailProviderId, EmailSender> = {
  gmail: sendGmail,
  outlook: sendOutlook,
  ses: sendSes,
  sendgrid: sendSendGrid,
  brevo: sendBrevo,
  smtp: sendSmtp,
  resend: sendResend,
};

export function getEmailSender(providerId: string): EmailSender | undefined {
  return emailSenders[providerId as EmailProviderId];
}

export const whatsAppTemplateSenders: Record<WhatsAppProviderId, WhatsAppTemplateSender> = {
  meta: sendMetaTemplate,
  "360dialog": send360DialogTemplate,
  gupshup: sendGupshupTemplate,
  interakt: sendInteraktTemplate,
  aisensy: sendAiSensyTemplate,
  twilio: sendTwilioTemplate,
  // No template system exists for this provider at all (see
  // TEXT_ONLY_WHATSAPP_PROVIDERS) — the worker never calls this for
  // 360messenger connections, but the Record type requires every
  // WhatsAppProviderId to have an entry.
  "360messenger": () => {
    throw new Error("360Messenger has no template system — use the text sender instead");
  },
};

export function getWhatsAppTemplateSender(providerId: string): WhatsAppTemplateSender | undefined {
  return whatsAppTemplateSenders[providerId as WhatsAppProviderId];
}

// meta/twilio: session-text, only valid within the 24h customer-service
// window (enforced by the caller). 360messenger: unofficial/personal-number
// provider with no template system at all, so this is its *primary* send
// path, not just a reply-window fallback — see TEXT_ONLY_WHATSAPP_PROVIDERS.
export const whatsAppTextSenders: Partial<Record<WhatsAppProviderId, WhatsAppTextSender>> = {
  meta: sendMetaText,
  twilio: sendTwilioText,
  "360messenger": send360MessengerText,
};

export function getWhatsAppTextSender(providerId: string): WhatsAppTextSender | undefined {
  return whatsAppTextSenders[providerId as WhatsAppProviderId];
}

export const aiCompleters: Record<AiProviderId, AiCompleter> = {
  anthropic: completeAnthropic,
  openai: completeOpenAi,
  gemini: completeGemini,
};

export function getAiCompleter(providerId: string): AiCompleter | undefined {
  return aiCompleters[providerId as AiProviderId];
}
