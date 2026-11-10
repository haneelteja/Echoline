import { describe, expect, it } from "vitest";
import { analyzeTemplate, optimizeTemplate } from "./deliverability";

const CLEAN_SUBJECT = "A quick idea for {{company}}";
const CLEAN_BODY = `Hi team at {{company}},

I came across {{company}}{{area_phrase}} and {{category_line}}

At Elma Industries, we produce custom-labelled packaged drinking water.

Would it be worth sending you a free sample label mock-up with your logo?

Just reply "yes", or message us on WhatsApp.`;

describe("analyzeTemplate", () => {
  it("returns no findings for a clean, already-optimized plain-text template", () => {
    expect(analyzeTemplate({ subject: CLEAN_SUBJECT, body: CLEAN_BODY, isHtml: false })).toEqual([]);
  });

  it("flags excess punctuation in the subject", () => {
    const findings = analyzeTemplate({ subject: "A quick idea!!!", body: CLEAN_BODY, isHtml: false });
    expect(findings.some((f) => f.id === "subject_excess_punctuation")).toBe(true);
  });

  it("flags emoji in the subject and body", () => {
    const findings = analyzeTemplate({ subject: "A quick idea 🎉", body: "Hi 👋 there", isHtml: false });
    expect(findings.some((f) => f.id === "subject_emoji")).toBe(true);
    expect(findings.some((f) => f.id === "body_emoji")).toBe(true);
  });

  it("flags shouty ALL-CAPS words but not short allowlisted acronyms", () => {
    const shouty = analyzeTemplate({ subject: "HUGE savings for your business", body: CLEAN_BODY, isHtml: false });
    expect(shouty.some((f) => f.id === "subject_all_caps")).toBe(true);

    const acronymOnly = analyzeTemplate({ subject: "A quick idea from our CEO", body: CLEAN_BODY, isHtml: false });
    expect(acronymOnly.some((f) => f.id === "subject_all_caps")).toBe(false);
  });

  it("flags marketing trigger phrases in subject and body", () => {
    const findings = analyzeTemplate({ subject: "Buy now and save", body: "Click here for 20% off, act now!", isHtml: false });
    expect(findings.some((f) => f.id.startsWith("subject_trigger:"))).toBe(true);
    expect(findings.some((f) => f.id.startsWith("body_trigger:"))).toBe(true);
  });

  it("flags the literal word 'unsubscribe' in the body", () => {
    const findings = analyzeTemplate({ subject: CLEAN_SUBJECT, body: "Hi there. To unsubscribe, reply STOP.", isHtml: false });
    expect(findings.some((f) => f.id === "body_unsubscribe_word")).toBe(true);
  });

  it("flags too many links in the body", () => {
    const body = "Check these out: https://a.test https://b.test https://c.test https://d.test";
    expect(analyzeTemplate({ subject: CLEAN_SUBJECT, body, isHtml: false }).some((f) => f.id === "body_too_many_links")).toBe(true);
  });

  it("flags a tracking-pixel-style image in raw HTML, distinct from a regular image", () => {
    const pixelFindings = analyzeTemplate({ subject: CLEAN_SUBJECT, body: '<p>Hi</p><img src="https://x.test/p" width="1" height="1">', isHtml: true });
    const pixelFinding = pixelFindings.find((f) => f.id === "html_image");
    expect(pixelFinding?.message).toMatch(/tracking pixel/i);

    const imageFindings = analyzeTemplate({ subject: CLEAN_SUBJECT, body: '<p>Hi</p><img src="https://x.test/photo.jpg" width="400">', isHtml: true });
    const imageFinding = imageFindings.find((f) => f.id === "html_image");
    expect(imageFinding?.message).not.toMatch(/tracking pixel/i);
  });

  it("flags a styled CTA-button-like link in raw HTML", () => {
    const findings = analyzeTemplate({
      subject: CLEAN_SUBJECT,
      body: '<p>Hi</p><a href="https://x.test" style="background:#000;color:#fff;padding:10px">Book a call</a>',
      isHtml: true,
    });
    expect(findings.some((f) => f.id === "html_cta_button")).toBe(true);
  });

  it("flags table-based layout in raw HTML as non-fixable", () => {
    const findings = analyzeTemplate({ subject: CLEAN_SUBJECT, body: "<table><tr><td>Hi</td></tr></table>", isHtml: true });
    const finding = findings.find((f) => f.id === "html_table_layout");
    expect(finding?.fixable).toBe(false);
  });

  it("does not flag an <img> that isn't present for a plain-text template", () => {
    expect(analyzeTemplate({ subject: CLEAN_SUBJECT, body: "<p>looks like html but isn't</p>", isHtml: false }).some((f) => f.id === "html_image")).toBe(false);
  });
});

describe("optimizeTemplate", () => {
  it("collapses repeated punctuation and strips emoji from the subject", () => {
    const { subject } = optimizeTemplate({ subject: "A quick idea!!! 🎉", body: CLEAN_BODY, isHtml: false });
    expect(subject).not.toMatch(/!!!/);
    expect(subject).not.toMatch(/🎉/u);
  });

  it("lowercases shouty ALL-CAPS words but preserves allowlisted acronyms", () => {
    const { subject } = optimizeTemplate({ subject: "HUGE idea from our CEO", body: CLEAN_BODY, isHtml: false });
    expect(subject).toContain("Huge");
    expect(subject).toContain("CEO");
  });

  it("removes marketing trigger phrases from subject and body", () => {
    const { subject, body } = optimizeTemplate({ subject: "Buy now and save", body: "Click here for 20% off, act now!", isHtml: false });
    expect(subject.toLowerCase()).not.toContain("buy now");
    expect(body.toLowerCase()).not.toContain("click here");
    expect(body.toLowerCase()).not.toContain("act now");
    expect(body).not.toContain("% off");
  });

  it("replaces the word 'unsubscribe' with a softer phrase", () => {
    const { body } = optimizeTemplate({ subject: CLEAN_SUBJECT, body: "To unsubscribe, reply STOP.", isHtml: false });
    expect(body.toLowerCase()).not.toContain("unsubscribe");
    expect(body).toContain("stop these emails");
  });

  it("strips <img> tags and de-styles CTA-button links in raw HTML, keeping the link itself", () => {
    const { body } = optimizeTemplate({
      subject: CLEAN_SUBJECT,
      body: '<p>Hi</p><img src="https://x.test/p" width="1" height="1"><a href="https://x.test/book" style="background:#000;color:#fff;padding:10px">Book a call</a>',
      isHtml: true,
    });
    expect(body).not.toContain("<img");
    expect(body).toContain('<a href="https://x.test/book">Book a call</a>');
  });

  it("re-analyzing optimized output yields no fixable findings left", () => {
    const dirty = {
      subject: "BUY NOW!!! 🎉 20% off",
      body: '<p>Click here 👋</p><img src="https://x.test/p" width="1" height="1"><a href="https://x.test" style="background:#000">Go</a> To unsubscribe, reply STOP.',
      isHtml: true,
    };
    const optimized = optimizeTemplate(dirty);
    const remaining = analyzeTemplate({ ...optimized, isHtml: true }).filter((f) => f.fixable);
    expect(remaining).toEqual([]);
  });
});
