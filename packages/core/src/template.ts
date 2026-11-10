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

// Also doubles as the example value Meta requires per variable at submission
// time — without one, Meta's review can reject the template outright or hold
// it indefinitely, since reviewers need to see realistic rendered text.
const PLACEHOLDER_EXAMPLES: Record<string, string> = {
  company: "Acme Corp",
  contact_name: "Priya",
  area: "Gachibowli",
  area_phrase: " in Gachibowli",
  category: "Restaurant",
  category_line: "noticed you serve great food",
  sender_name: "Haneel",
  brand: "Elma Industries",
  website: "https://example.com",
  whatsapp_number: "911234567890",
};

const KNOWN_PLACEHOLDER_KEYS = new Set(Object.keys(PLACEHOLDER_EXAMPLES));

/**
 * Meta requires WhatsApp template bodies to use positional {{1}}, {{2}}, ...
 * placeholders fixed at approval time, rather than our own named ones. This
 * derives both directly from the template body: `variableMap` is the ordered
 * list of our placeholder keys as they appear (duplicates kept, since a
 * repeated {{company}} still needs its own {{n}} slot per Meta's rules), and
 * `metaBody` is the same text with each occurrence replaced by its position.
 * `examples` is the matching list of example values for Meta's required
 * `example.body_text` on submission. An unknown `{{something}}` is left as
 * literal text (same fallback `fill()` uses), since Meta would otherwise
 * reject a template built from a typo.
 */
export function deriveMetaTemplateComponents(body: string): { metaBody: string; variableMap: string[]; examples: string[] } {
  const variableMap: string[] = [];
  const examples: string[] = [];
  const metaBody = String(body ?? "").replace(/\{\{\s*(\w+)\s*\}\}/g, (m, key: string) => {
    if (!KNOWN_PLACEHOLDER_KEYS.has(key)) return m;
    variableMap.push(key);
    examples.push(PLACEHOLDER_EXAMPLES[key]);
    return `{{${variableMap.length}}}`;
  });
  return { metaBody, variableMap, examples };
}

/**
 * Plain-text alternative to emailHTML(), mirroring the same footer (sender
 * name, brand/website, unsubscribe instructions) so clients that prefer
 * text/plain don't lose the sign-off or opt-out path.
 */
export function fillPlainText(
  text: string | null | undefined,
  ctx: FillContext,
  opts: { unsubscribeUrl?: string } = {}
): string {
  const p = ctx.project;
  const body = fill(text, ctx).trim();
  const signOff = [p.senderName, p.brand || p.name, p.website].filter(Boolean).join("\n");
  const footer = [`Not relevant? Reply "no" and we won't follow up.`, opts.unsubscribeUrl ? `Stop future emails: ${opts.unsubscribeUrl}` : null]
    .filter(Boolean)
    .join("\n");
  return [body, signOff, footer].filter(Boolean).join("\n\n");
}

/**
 * Plain-text fallback for a raw-HTML template body: a rough tag-strip, not a
 * full HTML-to-text conversion — good enough for the rare mail client that
 * prefers text/plain, which is what this alternative part is for either way.
 */
export function fillPlainTextFromRaw(rawBody: string | null | undefined, ctx: FillContext, opts: { unsubscribeUrl?: string } = {}): string {
  const stripped = fill(rawBody, ctx)
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
  const footer = [`Not relevant? Reply "no" and we won't follow up.`, opts.unsubscribeUrl ? `Stop future emails: ${opts.unsubscribeUrl}` : null]
    .filter(Boolean)
    .join("\n");
  return [stripped, footer].filter(Boolean).join("\n\n");
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

// Shared by emailHTML() and emailHTMLFromRaw() — the compliance footer
// (an opt-out path) always gets appended regardless of how the rest of the
// email was authored, so a hand-written raw-HTML template can't accidentally
// ship without one. Deliberately avoids the literal word "unsubscribe" and
// the List-Unsubscribe/List-Unsubscribe-Post headers (callers no longer send
// those) — confirmed live (2026-11-10) that even a fully plain-text email
// with those headers/wording still landed in Gmail's Promotions tab; both
// are near-direct "this is bulk mail" signals to Gmail's classifier. Opt-out
// still works via this plain link or replying "no" — just without the
// native one-click button mail clients render for List-Unsubscribe.
function emailShell(contentHtml: string, opts: EmailRenderOptions): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a">
${contentHtml}
<p style="margin:16px 0 0;font-size:12px;color:#767676">Not relevant? Reply "no" and we won't follow up.${opts.unsubscribeUrl ? ` Or <a href="${opts.unsubscribeUrl}">click here</a> and we'll stop.` : ""}</p>
</body></html>`;
}

/**
 * Renders as a plain, personal-looking message rather than the branded-
 * newsletter look this used to have. Confirmed live (2026-11-10): the old
 * version's combination of signals — branded logo header, inline image
 * gallery, a big colored CTA button, and an invisible open-tracking pixel —
 * is close to a checklist for Gmail's Promotions-tab classifier, and every
 * Initial-step send was landing there regardless of sender reputation.
 * `assets` and `opts.trackingPixelUrl`/`opts.rewriteLink` are still accepted
 * (callers still compute a gallery fetch and signed pixel/click URLs) but
 * deliberately have no effect on the rendered HTML anymore — only
 * `opts.unsubscribeUrl` still surfaces, as a plain footer link, since an
 * unsubscribe path is a compliance requirement, not a marketing signal.
 */
export function emailHTML(
  template: Pick<Template, "body">,
  ctx: FillContext,
  assets: EmailAssets,
  opts: EmailRenderOptions = {}
): string {
  void assets;
  const p = ctx.project;
  const wa = p.waNumber
    ? `https://wa.me/${p.waNumber.replace(/\D/g, "")}?text=${encodeURIComponent("Hi " + (p.brand || p.name) + ", I'm interested")}`
    : null;

  const paras = fill(template.body, ctx)
    .split(/\n{2,}/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => `<p style="margin:0 0 14px">${escapeHtml(x).replace(/\n/g, "<br>")}</p>`)
    .join("");

  const websiteLink = p.website ? `<a href="${escapeHtml(p.website)}">${escapeHtml(p.website.replace(/^https?:\/\//, ""))}</a>` : "";
  const brandLine = [escapeHtml(p.brand || p.name), websiteLink].filter(Boolean).join(" &middot; ");
  const signature = [p.senderName ? escapeHtml(p.senderName) : null, brandLine || null].filter(Boolean).join("<br>");

  const content = `${paras}
${wa ? `<p style="margin:0 0 14px">Or message us on WhatsApp: <a href="${wa}">${escapeHtml(p.waNumber || "")}</a></p>` : ""}
${signature ? `<p style="margin:18px 0 0">${signature}</p>` : ""}`;

  return emailShell(content, opts);
}

/**
 * For a template whose body is hand-written HTML (e.g. a custom CTA button
 * the plain-paragraph mode can't express) rather than plain text to be
 * auto-wrapped. Only {{placeholder}} substitution runs on it — no escaping,
 * no paragraph-splitting, no auto-signature — since the author's markup is
 * trusted content from their own template editor, not untrusted input. The
 * same compliance footer still gets appended via emailShell().
 */
export function emailHTMLFromRaw(rawBody: string | null | undefined, ctx: FillContext, opts: EmailRenderOptions = {}): string {
  return emailShell(fill(rawBody, ctx), opts);
}
