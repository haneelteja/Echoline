import type { ConnectionTester, ProviderId } from "./types";
import { testGmail } from "./email/gmail";
import { testOutlook } from "./email/outlook";
import { testSes } from "./email/ses";
import { testSendGrid } from "./email/sendgrid";
import { testBrevo } from "./email/brevo";
import { testSmtp } from "./email/smtp";
import { testMeta } from "./whatsapp/meta";
import { test360Dialog } from "./whatsapp/360dialog";
import { testGupshup } from "./whatsapp/gupshup";
import { testInterakt } from "./whatsapp/interakt";
import { testAiSensy } from "./whatsapp/aisensy";
import { testTwilio } from "./whatsapp/twilio";

export const connectionTesters: Record<ProviderId, ConnectionTester> = {
  gmail: testGmail,
  outlook: testOutlook,
  ses: testSes,
  sendgrid: testSendGrid,
  brevo: testBrevo,
  smtp: testSmtp,
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
