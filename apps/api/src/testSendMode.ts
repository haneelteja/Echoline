/**
 * Safety valve for the current testing phase: redirects every real send to a
 * fixed test inbox/number instead of the contact's actual email/phone.
 * Defaults to ON (safe by default) — unset TEST_SEND_MODE entirely, or set it
 * to "false", only once this deployment is actually ready to message real
 * leads. Must be set identically on echoline-api and echoline-worker (the
 * same env vars control the automated sequence and this manual send path).
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
