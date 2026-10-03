import type { ConnectionTester, EmailProviderId, EmailSender, ProviderId, WhatsAppProviderId, WhatsAppTemplateSender, WhatsAppTextSender } from "./types";
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
};

export function getWhatsAppTemplateSender(providerId: string): WhatsAppTemplateSender | undefined {
  return whatsAppTemplateSenders[providerId as WhatsAppProviderId];
}

// Only meta and twilio have a well-documented session-text send path; the
// others can be added once confirmed against their current docs.
export const whatsAppTextSenders: Partial<Record<WhatsAppProviderId, WhatsAppTextSender>> = {
  meta: sendMetaText,
  twilio: sendTwilioText,
};

export function getWhatsAppTextSender(providerId: string): WhatsAppTextSender | undefined {
  return whatsAppTextSenders[providerId as WhatsAppProviderId];
}
