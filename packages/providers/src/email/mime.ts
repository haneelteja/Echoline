export interface RawMimeAttachment {
  filename: string;
  /** Base64-encoded file content. */
  content: string;
  contentType: string;
}

export interface RawMimeInput {
  from: string;
  to: string;
  cc?: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
  replyTo?: string;
  attachments?: RawMimeAttachment[];
}

function encodeMimeSubject(subject: string): string {
  if (/^[\x00-\x7F]*$/.test(subject)) return subject;
  return `=?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`;
}

// RFC 2045 caps an encoded body line at 76 chars; most servers tolerate
// longer lines, but some don't, so base64 attachment content gets wrapped.
function wrapBase64(content: string): string {
  return content.match(/.{1,76}/g)?.join("\r\n") ?? content;
}

/** Builds a multipart/alternative (text + HTML) raw MIME message — needed by
 * Gmail's users.messages.send (raw base64url) and SES's raw send (only route
 * that supports arbitrary headers like List-Unsubscribe). When attachments
 * are present, that multipart/alternative part is nested inside an outer
 * multipart/mixed alongside one part per attachment — the standard structure
 * for a message that's both multi-format and has file attachments. */
export function buildRawMime(input: RawMimeInput): string {
  const altBoundary = `echoline_alt_${Math.random().toString(36).slice(2)}`;
  const altBody = [
    `--${altBoundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "",
    input.text,
    `--${altBoundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "",
    input.html,
    `--${altBoundary}--`,
  ].join("\r\n");

  const headerLines = [
    `From: ${input.from}`,
    `To: ${input.to}`,
    ...(input.cc ? [`Cc: ${input.cc}`] : []),
    ...(input.replyTo ? [`Reply-To: ${input.replyTo}`] : []),
    `Subject: ${encodeMimeSubject(input.subject)}`,
    "MIME-Version: 1.0",
    ...Object.entries(input.headers ?? {}).map(([k, v]) => `${k}: ${v}`),
  ];

  if (!input.attachments?.length) {
    return `${[...headerLines, `Content-Type: multipart/alternative; boundary="${altBoundary}"`].join("\r\n")}\r\n\r\n${altBody}`;
  }

  const mixedBoundary = `echoline_mix_${Math.random().toString(36).slice(2)}`;
  const attachmentParts = input.attachments.map((a) =>
    [
      `--${mixedBoundary}`,
      `Content-Type: ${a.contentType}; name="${a.filename}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${a.filename}"`,
      "",
      wrapBase64(a.content),
    ].join("\r\n")
  );
  const body = [
    `--${mixedBoundary}`,
    `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    "",
    altBody,
    ...attachmentParts,
    `--${mixedBoundary}--`,
  ].join("\r\n");
  return `${[...headerLines, `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`].join("\r\n")}\r\n\r\n${body}`;
}

export function toBase64Url(raw: string): string {
  return Buffer.from(raw, "utf8").toString("base64url");
}
