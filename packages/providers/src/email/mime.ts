export interface RawMimeInput {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
}

function encodeMimeSubject(subject: string): string {
  if (/^[\x00-\x7F]*$/.test(subject)) return subject;
  return `=?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`;
}

/** Builds a multipart/alternative (text + HTML) raw MIME message — needed by
 * Gmail's users.messages.send (raw base64url) and SES's raw send (only route
 * that supports arbitrary headers like List-Unsubscribe). */
export function buildRawMime(input: RawMimeInput): string {
  const boundary = `echoline_${Math.random().toString(36).slice(2)}`;
  const headerLines = [
    `From: ${input.from}`,
    `To: ${input.to}`,
    `Subject: ${encodeMimeSubject(input.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ...Object.entries(input.headers ?? {}).map(([k, v]) => `${k}: ${v}`),
  ];
  const body = [
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "",
    input.text,
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "",
    input.html,
    `--${boundary}--`,
  ].join("\r\n");
  return `${headerLines.join("\r\n")}\r\n\r\n${body}`;
}

export function toBase64Url(raw: string): string {
  return Buffer.from(raw, "utf8").toString("base64url");
}
