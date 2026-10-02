import type { Contact, ProjectBrand, Template } from "./types";

export interface FillContext {
  project: ProjectBrand;
  contact: Pick<Contact, "name" | "contactPerson" | "area" | "category">;
  template?: Pick<Template, "categoryLines"> | null;
}

const AREA_PLACEHOLDER = "Not Publicly Listed";

export function fill(text: string | null | undefined, ctx: FillContext): string {
  const { project: p, contact: c, template: t } = ctx;
  const categoryLines = t?.categoryLines ?? {};
  const map: Record<string, string> = {
    company: c.name || "there",
    contact_name: c.contactPerson || "team",
    area: c.area && c.area !== AREA_PLACEHOLDER ? c.area : "",
    area_phrase: c.area && c.area !== AREA_PLACEHOLDER ? " in " + c.area : "",
    category: c.category || "",
    category_line: categoryLines[c.category ?? ""] || categoryLines.default || "",
    sender_name: p.senderName || "",
    brand: p.brand || p.name || "",
    website: p.website || "",
    whatsapp_number: p.waNumber || "",
  };
  return String(text ?? "").replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (k in map ? map[k] : m));
}

/** Plain-text alternative: same paragraph fill, HTML stripped. */
export function fillPlainText(text: string | null | undefined, ctx: FillContext): string {
  return fill(text, ctx).trim();
}

export interface EmailAssets {
  logoUrl?: string | null;
  galleryUrls: string[];
}

export interface EmailRenderOptions {
  unsubscribeUrl?: string;
  trackingPixelUrl?: string;
  rewriteLink?: (url: string) => string;
}

function escapeHtml(v: unknown): string {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

/**
 * Ported from the prototype's emailHTML(). Adds a footer unsubscribe link and
 * (when provided) an open-tracking pixel. Link rewriting for click tracking is
 * applied via `opts.rewriteLink` before this function sees the template body.
 */
export function emailHTML(
  template: Pick<Template, "body">,
  ctx: FillContext,
  assets: EmailAssets,
  opts: EmailRenderOptions = {}
): string {
  const p = ctx.project;
  const accent = p.accent || "#3d1a5c";
  const wa = p.waNumber
    ? `https://wa.me/${p.waNumber.replace(/\D/g, "")}?text=${encodeURIComponent("Hi " + (p.brand || p.name) + ", I'm interested")}`
    : "#";

  const paras = fill(template.body, ctx)
    .split(/\n{2,}/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) =>
      x.startsWith("•") || x.startsWith("- ")
        ? `<table role="presentation" width="100%"><tr><td style="border-left:3px solid ${accent};background:#f8f6fb;padding:14px 18px;font-size:15px;line-height:1.9">${escapeHtml(x).replace(/\n/g, "<br>")}</td></tr></table><br>`
        : `<p style="margin:0 0 16px;font-size:15px;line-height:1.7">${escapeHtml(x).replace(/\n/g, "<br>")}</p>`
    )
    .join("");

  const imgs = assets.galleryUrls.slice(0, 3);

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f4f4f4;font-family:Arial,sans-serif;color:#1a1a1a">
  <table role="presentation" width="100%" style="padding:20px 0"><tr><td align="center"><table role="presentation" width="100%" style="max-width:680px;background:#fff;border-radius:10px;overflow:hidden;border:1px solid #e0e0e0">
  <tr><td style="background:${accent};padding:16px 24px;text-align:center">${assets.logoUrl ? `<img src="${assets.logoUrl}" width="100" style="background:#fff;border-radius:8px;padding:6px 12px">` : `<span style="color:#fff;font-weight:700;font-size:18px">${escapeHtml(p.brand || p.name)}</span>`}</td></tr>
  <tr><td style="padding:22px 24px 30px">${paras}
  ${imgs.length ? `<table role="presentation" width="100%"><tr>${imgs.map((src) => `<td style="padding:4px"><img src="${src}" width="100%" style="border-radius:6px;display:block"></td>`).join("")}</tr></table><br>` : ""}
  ${p.waNumber ? `<p style="text-align:center"><a href="${wa}" style="background:#25D366;color:#fff;text-decoration:none;font-weight:700;padding:12px 28px;border-radius:24px;display:inline-block">💬 Chat with us on WhatsApp</a></p>` : ""}
  <p style="margin:18px 0 2px;font-weight:600">${escapeHtml(p.senderName || "")}</p><p style="margin:0;color:#6b7280;font-size:14px">${escapeHtml(p.brand || p.name)}${p.website ? ` · <a href="${escapeHtml(p.website)}" style="color:${accent}">${escapeHtml(p.website.replace(/^https?:\/\//, ""))}</a>` : ""}</p>
  <p style="margin:16px 0 0;font-size:11px;color:#9ca3af">Not relevant? Reply "no" and we won't follow up.${opts.unsubscribeUrl ? ` Or <a href="${opts.unsubscribeUrl}" style="color:#9ca3af">unsubscribe</a>.` : ""}</p></td></tr></table></td></tr></table>${opts.trackingPixelUrl ? `<img src="${opts.trackingPixelUrl}" width="1" height="1" alt="" style="display:none">` : ""}</body></html>`;
}
