import { describe, expect, it } from "vitest";
import {
  buildClickRedirectUrl,
  buildOpenPixelUrl,
  buildUnsubscribeUrl,
  makeRewriteLink,
  verifyClickSignature,
  verifyOpenPixelSignature,
  verifyUnsubscribeSignature,
} from "./tracking";

const config = { secret: "test-signing-secret", baseUrl: "https://api.echoline.app" };

describe("open pixel", () => {
  it("builds a URL whose signature verifies for the same message id", () => {
    const url = buildOpenPixelUrl(config, "msg-123");
    const sig = new URL(url).searchParams.get("s")!;
    expect(verifyOpenPixelSignature(config, "msg-123", sig)).toBe(true);
  });

  it("rejects a signature minted for a different message id", () => {
    const url = buildOpenPixelUrl(config, "msg-123");
    const sig = new URL(url).searchParams.get("s")!;
    expect(verifyOpenPixelSignature(config, "msg-999", sig)).toBe(false);
  });

  it("rejects a tampered signature", () => {
    expect(verifyOpenPixelSignature(config, "msg-123", "not-the-real-signature")).toBe(false);
  });
});

describe("click redirect", () => {
  it("builds a URL whose signature verifies for the same message id and target", () => {
    const url = buildClickRedirectUrl(config, "msg-123", "https://elmawaterindustries.in/");
    const parsed = new URL(url);
    const sig = parsed.searchParams.get("s")!;
    const target = parsed.searchParams.get("u")!;
    expect(verifyClickSignature(config, "msg-123", target, sig)).toBe(true);
  });

  it("rejects a signature when the target URL is swapped (prevents open-redirect abuse)", () => {
    const url = buildClickRedirectUrl(config, "msg-123", "https://elmawaterindustries.in/");
    const sig = new URL(url).searchParams.get("s")!;
    expect(verifyClickSignature(config, "msg-123", "https://evil.test/phishing", sig)).toBe(false);
  });
});

describe("makeRewriteLink", () => {
  it("rewrites an external URL to a signed click-redirect link", () => {
    const rewrite = makeRewriteLink(config, "msg-123");
    const rewritten = rewrite("https://elmawaterindustries.in/");
    expect(rewritten).toContain(`${config.baseUrl}/t/c/msg-123`);
  });

  it("does not double-wrap a link that already points at our own domain", () => {
    const rewrite = makeRewriteLink(config, "msg-123");
    const ownLink = `${config.baseUrl}/unsubscribe/abc`;
    expect(rewrite(ownLink)).toBe(ownLink);
  });
});

describe("unsubscribe link", () => {
  it("builds a URL whose signature verifies for the same message id", () => {
    const url = buildUnsubscribeUrl(config, "msg-123");
    const sig = new URL(url).searchParams.get("s")!;
    expect(verifyUnsubscribeSignature(config, "msg-123", sig)).toBe(true);
  });

  it("rejects a signature minted for a different message id", () => {
    const url = buildUnsubscribeUrl(config, "msg-123");
    const sig = new URL(url).searchParams.get("s")!;
    expect(verifyUnsubscribeSignature(config, "msg-999", sig)).toBe(false);
  });
});
