import { describe, expect, it } from "vitest";
import { buildUnsubscribeHeaders, deriveMetaTemplateComponents, emailHTML, fill, fillPlainText } from "./template";
import type { ProjectBrand } from "./types";

const project: ProjectBrand = {
  name: "Elma Industries",
  brand: "Elma Industries",
  senderName: "Haneel",
  website: "https://elmawaterindustries.in/",
  waNumber: "916309060777",
  accent: "#3d1a5c",
};

describe("deriveMetaTemplateComponents", () => {
  it("replaces known placeholders with positional {{n}} markers in order", () => {
    const { metaBody, variableMap } = deriveMetaTemplateComponents("Hi {{company}}, {{category_line}} Regards, {{sender_name}}");
    expect(metaBody).toBe("Hi {{1}}, {{2}} Regards, {{3}}");
    expect(variableMap).toEqual(["company", "category_line", "sender_name"]);
  });

  it("gives a repeated placeholder its own separate position", () => {
    const { metaBody, variableMap } = deriveMetaTemplateComponents("{{company}} ... {{company}} again");
    expect(metaBody).toBe("{{1}} ... {{2}} again");
    expect(variableMap).toEqual(["company", "company"]);
  });

  it("leaves an unknown placeholder as literal text instead of mapping it", () => {
    const { metaBody, variableMap } = deriveMetaTemplateComponents("Hi {{company}}, {{typo_key}}");
    expect(metaBody).toBe("Hi {{1}}, {{typo_key}}");
    expect(variableMap).toEqual(["company"]);
  });

  it("returns an empty map for a body with no placeholders", () => {
    const { metaBody, variableMap, examples } = deriveMetaTemplateComponents("Plain text, no variables.");
    expect(metaBody).toBe("Plain text, no variables.");
    expect(variableMap).toEqual([]);
    expect(examples).toEqual([]);
  });

  it("returns a matching example value for each variable, for Meta's required example.body_text", () => {
    const { variableMap, examples } = deriveMetaTemplateComponents("Hi {{company}}, {{category_line}}");
    expect(examples).toHaveLength(variableMap.length);
    expect(examples.every((e) => typeof e === "string" && e.length > 0)).toBe(true);
  });
});

describe("fill", () => {
  it("substitutes placeholders from contact and project", () => {
    const out = fill("Hi {{company}}{{area_phrase}}, from {{brand}}", {
      project,
      contact: { name: "Acme", area: "Gachibowli" },
    });
    expect(out).toBe("Hi Acme in Gachibowli, from Elma Industries");
  });

  it("falls back to the default category line", () => {
    const out = fill("{{category_line}}", {
      project,
      contact: { name: "Acme", category: "Unknown Category" },
      template: { categoryLines: { Restaurant: "about restaurants", default: "generic line" } },
    });
    expect(out).toBe("generic line");
  });

  it("treats 'Not Publicly Listed' area as empty", () => {
    const out = fill("{{area_phrase}}", {
      project,
      contact: { name: "Acme", area: "Not Publicly Listed" },
    });
    expect(out).toBe("");
  });

  it("leaves unknown placeholders untouched", () => {
    const out = fill("{{mystery}}", { project, contact: { name: "Acme" } });
    expect(out).toBe("{{mystery}}");
  });
});

describe("emailHTML", () => {
  it("includes the unsubscribe link and tracking pixel when provided", () => {
    const html = emailHTML(
      { body: "Hi {{company}}" },
      { project, contact: { name: "Acme" } },
      { galleryUrls: [] },
      { unsubscribeUrl: "https://x.test/u/1", trackingPixelUrl: "https://x.test/p/1" }
    );
    expect(html).toContain("https://x.test/u/1");
    expect(html).toContain("https://x.test/p/1");
    expect(html).toContain("Acme");
  });

  it("rewrites the website link through rewriteLink when provided (click tracking)", () => {
    const html = emailHTML(
      { body: "Hi {{company}}" },
      { project, contact: { name: "Acme" } },
      { galleryUrls: [] },
      { rewriteLink: (url) => `https://track.test/c?u=${encodeURIComponent(url)}` }
    );
    expect(html).toContain(`https://track.test/c?u=${encodeURIComponent(project.website!)}`);
    expect(html).not.toContain(`href="${project.website}"`);
  });

  it("rewrites the WhatsApp CTA link through rewriteLink too", () => {
    const html = emailHTML(
      { body: "Hi {{company}}" },
      { project, contact: { name: "Acme" } },
      { galleryUrls: [] },
      { rewriteLink: (url) => `https://track.test/c?u=${encodeURIComponent(url)}` }
    );
    expect(html).toContain("https://track.test/c?u=https%3A%2F%2Fwa.me%2F916309060777");
  });

  it("leaves links untouched when no rewriteLink is given", () => {
    const html = emailHTML({ body: "Hi {{company}}" }, { project, contact: { name: "Acme" } }, { galleryUrls: [] });
    expect(html).toContain(`href="${project.website}"`);
  });
});

describe("fillPlainText", () => {
  it("includes the body, sign-off, and unsubscribe instructions", () => {
    const text = fillPlainText("Hi {{company}}, nice to meet you.", { project, contact: { name: "Acme" } }, { unsubscribeUrl: "https://x.test/u/1" });
    expect(text).toContain("Hi Acme, nice to meet you.");
    expect(text).toContain("Haneel");
    expect(text).toContain("Elma Industries");
    expect(text).toContain("https://elmawaterindustries.in/");
    expect(text).toContain("Unsubscribe: https://x.test/u/1");
  });

  it("omits the unsubscribe line when no URL is given", () => {
    const text = fillPlainText("Hi there", { project, contact: { name: "Acme" } });
    expect(text).not.toContain("Unsubscribe:");
    expect(text).toContain(`Not relevant? Reply "no"`);
  });
});

describe("buildUnsubscribeHeaders", () => {
  it("builds RFC 8058 one-click headers from a URL only", () => {
    const headers = buildUnsubscribeHeaders("https://x.test/u/1");
    expect(headers["List-Unsubscribe"]).toBe("<https://x.test/u/1>");
    expect(headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });

  it("includes a mailto target first when provided", () => {
    const headers = buildUnsubscribeHeaders("https://x.test/u/1", "unsub@echoline.app");
    expect(headers["List-Unsubscribe"]).toBe("<mailto:unsub@echoline.app>, <https://x.test/u/1>");
  });
});
