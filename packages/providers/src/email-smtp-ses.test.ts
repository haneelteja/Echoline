import { describe, expect, it, vi } from "vitest";
import type { EmailMessage } from "./types";

const message: EmailMessage = {
  from: "sender@brand.com",
  to: "lead@customer.com",
  subject: "Hello",
  html: "<p>Hi</p>",
  text: "Hi",
};

const verifyMock = vi.fn();
const sendMailMock = vi.fn();
const closeMock = vi.fn();
vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn(() => ({ verify: verifyMock, sendMail: sendMailMock, close: closeMock })),
  },
}));

const sendMock = vi.fn();
vi.mock("@aws-sdk/client-sesv2", () => ({
  SESv2Client: vi.fn().mockImplementation(() => ({ send: sendMock })),
  GetAccountCommand: vi.fn(),
  SendEmailCommand: class {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  },
}));

describe("testSmtp", () => {
  it("requires host/port/user/pass", async () => {
    const { testSmtp } = await import("./email/smtp");
    const result = await testSmtp({ host: "smtp.test.com" });
    expect(result.ok).toBe(false);
  });

  it("succeeds when the transport verifies", async () => {
    verifyMock.mockResolvedValueOnce(true);
    const { testSmtp } = await import("./email/smtp");
    const result = await testSmtp({ host: "smtp.test.com", port: "587", user: "me@test.com", pass: "secret" });
    expect(result).toEqual({ ok: true, accountLabel: "me@test.com" });
    expect(closeMock).toHaveBeenCalled();
  });

  it("fails and still closes the transport when verify rejects", async () => {
    verifyMock.mockRejectedValueOnce(new Error("auth failed"));
    const { testSmtp } = await import("./email/smtp");
    const result = await testSmtp({ host: "smtp.test.com", port: "587", user: "me@test.com", pass: "wrong" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/auth failed/);
    expect(closeMock).toHaveBeenCalled();
  });
});

describe("testSes", () => {
  it("requires accessKeyId/secretAccessKey/region", async () => {
    const { testSes } = await import("./email/ses");
    const result = await testSes({ accessKeyId: "AKIA" });
    expect(result.ok).toBe(false);
  });

  it("succeeds when GetAccountCommand resolves", async () => {
    sendMock.mockResolvedValueOnce({});
    const { testSes } = await import("./email/ses");
    const result = await testSes({ accessKeyId: "AKIA", secretAccessKey: "secret", region: "ap-south-1" });
    expect(result).toEqual({ ok: true, accountLabel: "SES (ap-south-1)" });
  });

  it("fails when the SDK call rejects", async () => {
    sendMock.mockRejectedValueOnce(new Error("The security token included in the request is invalid"));
    const { testSes } = await import("./email/ses");
    const result = await testSes({ accessKeyId: "AKIA", secretAccessKey: "bad", region: "ap-south-1" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/security token/);
  });
});

describe("sendSmtp", () => {
  it("sends via nodemailer and closes the transport", async () => {
    sendMailMock.mockResolvedValueOnce({ messageId: "<smtp-msg-1@test>" });
    const { sendSmtp } = await import("./email/smtp");
    const result = await sendSmtp({ host: "smtp.test.com", port: "587", user: "me@test.com", pass: "secret" }, message);
    expect(result).toEqual({ providerMessageId: "<smtp-msg-1@test>" });
    expect(sendMailMock).toHaveBeenCalledWith(expect.objectContaining({ to: message.to, subject: message.subject }));
    expect(closeMock).toHaveBeenCalled();
  });

  it("closes the transport even when sendMail rejects", async () => {
    sendMailMock.mockRejectedValueOnce(new Error("mailbox unavailable"));
    const { sendSmtp } = await import("./email/smtp");
    await expect(sendSmtp({ host: "smtp.test.com", port: "587", user: "me@test.com", pass: "secret" }, message)).rejects.toThrow(
      /mailbox unavailable/
    );
    expect(closeMock).toHaveBeenCalled();
  });
});

describe("sendSes", () => {
  it("sends a raw MIME message and returns the SES MessageId", async () => {
    sendMock.mockResolvedValueOnce({ MessageId: "ses-msg-1" });
    const { sendSes } = await import("./email/ses");
    const result = await sendSes({ accessKeyId: "AKIA", secretAccessKey: "secret", region: "ap-south-1" }, message);
    expect(result).toEqual({ providerMessageId: "ses-msg-1" });
    const [sentCommand] = sendMock.mock.calls.at(-1)!;
    const rawBytes: Buffer = (sentCommand as { input: { Content: { Raw: { Data: Buffer } } } }).input.Content.Raw.Data;
    expect(rawBytes.toString("utf8")).toContain("Hi</p>");
  });
});
