import { describe, expect, it, vi } from "vitest";

const verifyMock = vi.fn();
const closeMock = vi.fn();
vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn(() => ({ verify: verifyMock, close: closeMock })),
  },
}));

const sendMock = vi.fn();
vi.mock("@aws-sdk/client-sesv2", () => ({
  SESv2Client: vi.fn().mockImplementation(() => ({ send: sendMock })),
  GetAccountCommand: vi.fn(),
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
