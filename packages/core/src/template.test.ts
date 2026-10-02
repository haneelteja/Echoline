import { describe, expect, it } from "vitest";
import { emailHTML, fill } from "./template";
import type { ProjectBrand } from "./types";

const project: ProjectBrand = {
  name: "Elma Industries",
  brand: "Elma Industries",
  senderName: "Haneel",
  website: "https://elmawaterindustries.in/",
  waNumber: "916309060777",
  accent: "#3d1a5c",
};

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
});
