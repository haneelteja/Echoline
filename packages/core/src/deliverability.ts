/**
 * Heuristic guardrails against Gmail's Promotions-tab classifier, scoped to
 * what a template's own content can control. Confirmed live (2026-11-10)
 * across several rounds: branded HTML (logo/gallery/CTA button/tracking
 * pixel), the List-Unsubscribe headers, and the literal word "unsubscribe"
 * were all real signals — the render layer (template.ts) and send paths no
 * longer produce any of those by default. This module catches the same
 * class of signal when a user re-introduces it themselves — most commonly
 * via a hand-written raw-HTML body (packages/core's `body_is_html` mode),
 * but the phrase/punctuation/emoji checks apply to plain-text bodies too.
 *
 * Deliberately advisory, not a hard block: these are heuristics with real
 * false-positive risk (e.g. a business's own name happening to be all-caps,
 * or "click here" appearing in an otherwise-fine sentence), and a template
 * author's actual words should win over a pattern match. Two other real
 * causes of Promotions placement are explicitly NOT handled here, because
 * no per-template content change can fix them: (1) Gmail's per-recipient
 * learned history — an address that received an earlier, unoptimized send
 * stays filed under Promotions for that sender until the recipient manually
 * moves one message to Primary; (2) sending-domain reputation/authentication
 * (SPF/DKIM/DMARC) — a infrastructure concern, not a template one.
 */

export interface TemplateContent {
  subject: string;
  body: string;
  isHtml: boolean;
}

export interface DeliverabilityFinding {
  id: string;
  field: "subject" | "body";
  severity: "high" | "medium";
  message: string;
  /** Whether optimizeTemplate() can resolve this one automatically. */
  fixable: boolean;
}

// Phrases strongly associated with marketing/bulk email. Deliberately a
// short list of distinctive multi-word phrases rather than single common
// words (e.g. "free" alone is too common in genuine prose — "feel free to
// reply" — to be useful signal; "buy now" essentially never appears outside
// a marketing CTA).
const TRIGGER_PHRASES = [
  "% off",
  "buy now",
  "act now",
  "limited time offer",
  "limited time",
  "exclusive deal",
  "exclusive offer",
  "best price",
  "lowest price",
  "risk free",
  "no cost to you",
  "money back guarantee",
  "earn extra cash",
  "work from home",
  "click here to subscribe",
  "subscribe now",
  "congratulations, you",
  "you've been selected",
  "click here",
];

// Short acronyms/brand terms that are legitimately all-caps and shouldn't be
// flagged or rewritten as shouting.
const CAPS_ALLOWLIST = new Set(["OK", "FAQ", "CEO", "CTO", "CFO", "USA", "UK", "AI", "KB", "ID", "PDF", "HR", "IT", "ASAP", "VIP"]);

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu;
const SHOUTY_WORD_RE = /\b[A-Z]{3,}\b/g;

// EMOJI_RE carries the global flag (needed for the .replace() calls in
// optimizeTemplate()) — reusing a global-flagged RegExp across multiple
// .test() calls is stateful (lastIndex persists from the previous call), so
// every .test() use resets it first to avoid silently skipping a match.
function containsEmoji(text: string): boolean {
  EMOJI_RE.lastIndex = 0;
  return EMOJI_RE.test(text);
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ");
}

function countLinks(body: string, isHtml: boolean): number {
  if (isHtml) return (body.match(/<a\s[^>]*href\s*=/gi) ?? []).length;
  return (body.match(/https?:\/\/\S+/gi) ?? []).length;
}

function findTriggerPhrases(text: string): string[] {
  const lower = text.toLowerCase();
  return TRIGGER_PHRASES.filter((p) => lower.includes(p));
}

function hasShoutyWord(text: string): boolean {
  const matches = text.match(SHOUTY_WORD_RE) ?? [];
  return matches.some((w) => !CAPS_ALLOWLIST.has(w));
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function removePhrase(text: string, phrase: string): string {
  return text.replace(new RegExp(escapeRegExp(phrase), "gi"), "");
}

function tidyWhitespace(text: string): string {
  return text
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s+([.,!?])/g, "$1")
    .trim();
}

/** Scans a template's subject/body for known Promotions-tab signals. */
export function analyzeTemplate({ subject, body, isHtml }: TemplateContent): DeliverabilityFinding[] {
  const findings: DeliverabilityFinding[] = [];

  if (/([!?])\1+/.test(subject)) {
    findings.push({
      id: "subject_excess_punctuation",
      field: "subject",
      severity: "medium",
      message: `Repeated "!" or "?" in the subject reads as a marketing blast rather than a personal note.`,
      fixable: true,
    });
  }
  if (containsEmoji(subject)) {
    findings.push({ id: "subject_emoji", field: "subject", severity: "medium", message: "Emoji in the subject line is a common promotional signal.", fixable: true });
  }
  if (hasShoutyWord(subject)) {
    findings.push({ id: "subject_all_caps", field: "subject", severity: "medium", message: "ALL-CAPS word(s) in the subject read as shouting/promotional.", fixable: true });
  }
  for (const phrase of findTriggerPhrases(subject)) {
    findings.push({ id: `subject_trigger:${phrase}`, field: "subject", severity: "high", message: `"${phrase}" in the subject is a strong marketing-email signal.`, fixable: true });
  }

  const plainBody = isHtml ? stripTags(body) : body;

  if (/\bunsubscribe\b/i.test(plainBody)) {
    findings.push({
      id: "body_unsubscribe_word",
      field: "body",
      severity: "high",
      message: `The word "unsubscribe" is one of the strongest signals Gmail uses to route mail to Promotions. The app's own footer no longer uses it — if it's appearing, you likely typed it into the body yourself.`,
      fixable: true,
    });
  }
  for (const phrase of findTriggerPhrases(plainBody)) {
    findings.push({ id: `body_trigger:${phrase}`, field: "body", severity: "high", message: `"${phrase}" in the body is a strong marketing-email signal.`, fixable: true });
  }
  if (containsEmoji(plainBody)) {
    findings.push({ id: "body_emoji", field: "body", severity: "medium", message: "Emoji in the body is a common promotional signal.", fixable: true });
  }

  const linkCount = countLinks(body, isHtml);
  if (linkCount > 3) {
    findings.push({
      id: "body_too_many_links",
      field: "body",
      severity: "medium",
      message: `${linkCount} links in the body — a genuine 1:1 email usually has 0–2; this many reads as a marketing blast. Consider trimming.`,
      fixable: false,
    });
  }

  if (isHtml) {
    if (/<img\b/i.test(body)) {
      const looksLikeTrackingPixel = /<img\b[^>]*\b(?:width|height)\s*=\s*["']?[01]\b/i.test(body);
      findings.push({
        id: "html_image",
        field: "body",
        severity: "high",
        message: looksLikeTrackingPixel
          ? "Contains what looks like an invisible 1x1 tracking pixel — one of the strongest bulk-mail signals there is."
          : "Contains an <img> — plain personal emails rarely include images, and this reads as a marketing email to Gmail's classifier.",
        fixable: true,
      });
    }
    if (/<a\b[^>]*\bstyle\s*=\s*["'][^"']*background[^"']*["'][^>]*>/i.test(body)) {
      findings.push({
        id: "html_cta_button",
        field: "body",
        severity: "high",
        message: "Contains a styled, button-like link (background color) — reads as a marketing call-to-action rather than a plain link in a personal email.",
        fixable: true,
      });
    }
    if (/<table\b/i.test(body)) {
      findings.push({
        id: "html_table_layout",
        field: "body",
        severity: "medium",
        message: "Uses an HTML <table> for layout — a common newsletter-template pattern. Consider plain paragraphs instead.",
        fixable: false,
      });
    }
  }

  return findings;
}

/**
 * Applies every automatic fix analyzeTemplate() flagged as `fixable`, in one
 * pass. Returns a new {subject, body} — callers decide whether to apply it
 * (e.g. into a draft for review before saving, never silently on save).
 */
export function optimizeTemplate({ subject, body, isHtml }: TemplateContent): { subject: string; body: string } {
  let newSubject = subject;
  let newBody = body;

  newSubject = newSubject.replace(/([!?])\1+/g, "$1");
  newSubject = newSubject.replace(EMOJI_RE, "");
  newSubject = newSubject.replace(SHOUTY_WORD_RE, (w) => (CAPS_ALLOWLIST.has(w) ? w : w.charAt(0) + w.slice(1).toLowerCase()));
  for (const phrase of TRIGGER_PHRASES) newSubject = removePhrase(newSubject, phrase);
  newSubject = tidyWhitespace(newSubject);

  if (isHtml) {
    newBody = newBody.replace(/<img\b[^>]*>/gi, "");
    newBody = newBody.replace(/(<a\b[^>]*?)\s+style\s*=\s*(["'])[^"']*background[^"']*\2([^>]*>)/gi, "$1$3");
  }
  newBody = newBody.replace(/\bunsubscribe\b/gi, "stop these emails");
  for (const phrase of TRIGGER_PHRASES) newBody = removePhrase(newBody, phrase);
  newBody = newBody.replace(EMOJI_RE, "");
  newBody = tidyWhitespace(newBody);

  return { subject: newSubject, body: newBody };
}
