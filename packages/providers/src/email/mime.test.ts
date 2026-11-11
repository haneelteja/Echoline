import { describe, expect, it } from "vitest";
import { buildRawMime, toBase64Url, type RawMimeInput } from "./mime";

const base: RawMimeInput = {
  from: "sender@brand.com",
  to: "lead@customer.com",
  subject: "Hello",
  html: "<p>Hi</p>",
  text: "Hi",
};

describe("buildRawMime", () => {
  it("builds a plain multipart/alternative message with no attachments", () => {
    const raw = buildRawMime(base);
    expect(raw).toContain("Content-Type: multipart/alternative;");
    expect(raw).not.toContain("multipart/mixed");
    expect(raw).toContain("Hi</p>");
    expect(raw).toContain("Hi\r\n");
  });

  it("wraps the alternative part inside multipart/mixed when attachments are present, one part per attachment", () => {
    const raw = buildRawMime({
      ...base,
      attachments: [
        { filename: "logo.png", content: Buffer.from("fake-png-bytes").toString("base64"), contentType: "image/png" },
        { filename: "pricelist.pdf", content: Buffer.from("fake-pdf-bytes").toString("base64"), contentType: "application/pdf" },
      ],
    });
    expect(raw).toContain("Content-Type: multipart/mixed;");
    expect(raw).toContain("Content-Type: multipart/alternative;");
    expect(raw).toContain('Content-Disposition: attachment; filename="logo.png"');
    expect(raw).toContain('Content-Disposition: attachment; filename="pricelist.pdf"');
    expect(raw).toContain("Content-Type: image/png;");
    expect(raw).toContain("Content-Type: application/pdf;");
    expect(raw).toContain("Content-Transfer-Encoding: base64");
    // body content still present inside the nested alternative part
    expect(raw).toContain("Hi</p>");
    // base64 payload for each attachment survives the round trip
    expect(raw.replace(/\r\n/g, "")).toContain(Buffer.from("fake-png-bytes").toString("base64"));
    expect(raw.replace(/\r\n/g, "")).toContain(Buffer.from("fake-pdf-bytes").toString("base64"));
  });

  it("wraps long base64 attachment content at 76 characters per line", () => {
    const longContent = Buffer.from("x".repeat(200)).toString("base64");
    const raw = buildRawMime({ ...base, attachments: [{ filename: "big.bin", content: longContent, contentType: "application/octet-stream" }] });
    const bodySection = raw.split('Content-Disposition: attachment; filename="big.bin"\r\n\r\n')[1]!.split("\r\n--")[0]!;
    const bodyLines = bodySection.split("\r\n");
    for (const line of bodyLines) {
      expect(line.length).toBeLessThanOrEqual(76);
    }
    expect(bodyLines.join("")).toBe(longContent);
  });
});

describe("toBase64Url", () => {
  it("round-trips a raw MIME string through base64url", () => {
    const raw = buildRawMime(base);
    const encoded = toBase64Url(raw);
    expect(Buffer.from(encoded, "base64url").toString("utf8")).toBe(raw);
  });
});
