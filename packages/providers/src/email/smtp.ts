import nodemailer from "nodemailer";
import type { ConnectionTester } from "../types";

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
