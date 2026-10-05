/**
 * Safety valve for the current testing phase: redirects every real send to a
 * fixed test inbox/number instead of the contact's actual email/phone.
 * Defaults to ON (safe by default) — unset TEST_SEND_MODE entirely, or set it
 * to "false", only once this deployment is actually ready to message real
 * leads. Controls both the automated sequence (emailWorker/whatsappWorker)
 * and the manual "send now" feature identically via the same env vars.
 */
export function isTestSendMode(): boolean {
  return process.env.TEST_SEND_MODE !== "false";
}

export function testSendEmail(): string {
  return process.env.TEST_SEND_EMAIL || "pega2023test@gmail.com";
}

export function testSendWhatsApp(): string {
  return process.env.TEST_SEND_WHATSAPP || "9642917777";
}
