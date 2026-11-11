import { describe, expect, it, vi, beforeEach } from "vitest";

const connectMock = vi.fn();
const logoutMock = vi.fn();
const lockReleaseMock = vi.fn();
const getMailboxLockMock = vi.fn(() => ({ release: lockReleaseMock }));
const searchMock = vi.fn();
const fetchAllMock = vi.fn();
const messageFlagsAddMock = vi.fn();

vi.mock("imapflow", () => ({
  ImapFlow: vi.fn().mockImplementation(() => ({
    connect: connectMock,
    logout: logoutMock,
    getMailboxLock: getMailboxLockMock,
    search: searchMock,
    fetchAll: fetchAllMock,
    messageFlagsAdd: messageFlagsAddMock,
  })),
}));

const simpleParserMock = vi.fn();
vi.mock("mailparser", () => ({ simpleParser: simpleParserMock }));

const CREDENTIALS = { host: "imap.test.com", port: "993", user: "me@test.com", pass: "secret" };

beforeEach(() => {
  vi.clearAllMocks();
  getMailboxLockMock.mockReturnValue({ release: lockReleaseMock });
});

describe("fetchAndConsumeUnseenImapMessages", () => {
  it("returns an empty list and skips fetchAll when there are no unseen messages", async () => {
    searchMock.mockResolvedValueOnce([]);
    const { fetchAndConsumeUnseenImapMessages } = await import("./imap");
    const replies = await fetchAndConsumeUnseenImapMessages(CREDENTIALS);
    expect(replies).toEqual([]);
    expect(fetchAllMock).not.toHaveBeenCalled();
    expect(logoutMock).toHaveBeenCalled();
  });

  it("extracts the plain-text body via mailparser and marks messages seen", async () => {
    searchMock.mockResolvedValueOnce([1]);
    fetchAllMock.mockResolvedValueOnce([
      { envelope: { from: [{ address: "Lead@Customer.com" }], subject: "Re: pricing" }, source: Buffer.from("raw-mime") },
    ]);
    simpleParserMock.mockResolvedValueOnce({ text: "Can you send a quotation for 500 units?", html: null });

    const { fetchAndConsumeUnseenImapMessages } = await import("./imap");
    const replies = await fetchAndConsumeUnseenImapMessages(CREDENTIALS);

    expect(replies).toEqual([{ fromAddress: "lead@customer.com", subject: "Re: pricing", bodyText: "Can you send a quotation for 500 units?" }]);
    expect(messageFlagsAddMock).toHaveBeenCalledWith([1], ["\\Seen"], { uid: true });
  });

  it("falls back to HTML-stripped text when there's no text/plain part", async () => {
    searchMock.mockResolvedValueOnce([2]);
    fetchAllMock.mockResolvedValueOnce([{ envelope: { from: [{ address: "lead@customer.com" }], subject: "Re: hi" }, source: Buffer.from("raw-mime") }]);
    simpleParserMock.mockResolvedValueOnce({ text: null, html: "<p>Please <b>unsubscribe</b> me</p>" });

    const { fetchAndConsumeUnseenImapMessages } = await import("./imap");
    const replies = await fetchAndConsumeUnseenImapMessages(CREDENTIALS);

    expect(replies[0]!.bodyText).toBe("Please unsubscribe me");
  });

  it("still records the reply (with empty bodyText) when parsing throws", async () => {
    searchMock.mockResolvedValueOnce([3]);
    fetchAllMock.mockResolvedValueOnce([{ envelope: { from: [{ address: "lead@customer.com" }], subject: "Re: broken" }, source: Buffer.from("raw-mime") }]);
    simpleParserMock.mockRejectedValueOnce(new Error("malformed MIME"));

    const { fetchAndConsumeUnseenImapMessages } = await import("./imap");
    const replies = await fetchAndConsumeUnseenImapMessages(CREDENTIALS);

    expect(replies).toEqual([{ fromAddress: "lead@customer.com", subject: "Re: broken", bodyText: "" }]);
  });

  it("truncates body text to 4000 characters", async () => {
    searchMock.mockResolvedValueOnce([4]);
    fetchAllMock.mockResolvedValueOnce([{ envelope: { from: [{ address: "lead@customer.com" }], subject: "Re: long" }, source: Buffer.from("raw-mime") }]);
    simpleParserMock.mockResolvedValueOnce({ text: "x".repeat(5000), html: null });

    const { fetchAndConsumeUnseenImapMessages } = await import("./imap");
    const replies = await fetchAndConsumeUnseenImapMessages(CREDENTIALS);

    expect(replies[0]!.bodyText.length).toBe(4000);
  });
});
