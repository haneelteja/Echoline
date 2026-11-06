/**
 * Safety valve for the current testing phase: redirects every real send to a
 * fixed test inbox/number instead of the contact's actual email/phone.
 * Two-key system: the TEST_SEND_MODE env var is a deployment-wide switch
 * that defaults to ON (safe) — while it's on (unset, or anything other than
 * exactly "false"), every project stays in test mode regardless of its own
 * setting. Only once someone has deliberately turned it off deployment-wide
 * does each project's own `test_send_mode` column (editable in Project
 * settings, restricted to one operator account — see projects.ts) take over
 * as the per-project gate, itself defaulting to true. Must be set identically
 * on echoline-api and echoline-worker (the same env var controls both the
 * automated sequence and this manual send path).
 */
export function isTestSendMode(projectTestSendMode: boolean | null | undefined): boolean {
  if (process.env.TEST_SEND_MODE !== "false") return true;
  return projectTestSendMode !== false;
}

export function testSendEmail(): string {
  return process.env.TEST_SEND_EMAIL || "pega2023test@gmail.com";
}

export function testSendWhatsApp(): string {
  return process.env.TEST_SEND_WHATSAPP || "9642917777";
}
