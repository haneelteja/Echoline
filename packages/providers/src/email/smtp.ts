import nodemailer from "nodemailer";
import type { ConnectionTester, EmailSender } from "../types";

export const testSmtp: ConnectionTester = async (credentials) => {
  const { host, port, user, pass } = credentials;
  const secure = credentials.secure === "true";
  if (!host || !port || !user || !pass) {
    return { ok: false, error: "host, port, user and pass are required" };
  }
  const transport = nodemailer.createTransport({
    host,
    port: Number(port),
    secure,
    auth: { user, pass },
  });
  try {
    await transport.verify();
    return { ok: true, accountLabel: user };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "SMTP verification failed" };
  } finally {
    transport.close();
  }
};

export const sendSmtp: EmailSender = async (credentials, message) => {
  const { host, port, user, pass } = credentials;
  const secure = credentials.secure === "true";
  if (!host || !port || !user || !pass) throw new Error("host, port, user and pass are required");
  const transport = nodemailer.createTransport({ host, port: Number(port), secure, auth: { user, pass } });
  try {
    const info = await transport.sendMail({
      from: message.from,
      to: message.to,
      cc: message.cc,
      replyTo: message.replyTo,
      subject: message.subject,
      html: message.html,
      text: message.text,
      headers: message.headers,
      attachments: message.attachments?.map((a) => ({ filename: a.filename, content: Buffer.from(a.content, "base64"), contentType: a.contentType })),
    });
    return { providerMessageId: info.messageId };
  } finally {
    transport.close();
  }
};
