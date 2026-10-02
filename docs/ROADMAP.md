# Roadmap

## Implemented (prototype)
- Multi-project workspaces (Elma preloaded from the Make scenario)
- Branded UI: logo, light/dark theme, mobile layout
- Dashboard: reach rings (Leads → Reached → Engaged → Replied), email vs WhatsApp funnels with drop-off, rule-based insights + AI analysis, 14-day send chart, 7-day schedule, category and area breakdowns, data health
- Knowledge base: brand facts, SKU table (Excel import), notes, product images tagged email / WhatsApp / logo
- AI templates: 3-step email or WhatsApp sequences with category-specific opening lines; AI rewrite
- Template editor with live email HTML and WhatsApp previews; Meta template name and approval status
- Sequence builder: step delays, daily cap, send window, stop-on-reply
- Leads: per-channel status, delivery tracking, timeline, filters, CSV export
- Lead import: Excel/CSV with auto column mapping and de-duplication
- Settings screens for email/WhatsApp providers, tracking options and lead sources (config only)

## Implemented (Phase 1 — foundation, auth, roles)

- Monorepo: pnpm workspaces, TypeScript strict, `apps/{web,api,worker}` + `packages/{core,db,providers}`
- Supabase Postgres schema + RLS for the full data model: organizations, memberships,
  projects, sequence/channel/brand settings, contacts, templates, kb_items, lead_sources,
  provider_connections, messages, message_events (append-only), plans/subscriptions/usage_counters (stubs)
- Role hierarchy (owner, admin, operator, viewer, client_viewer) enforced in Postgres RLS
  policies and mirrored as API-level error handling
- `packages/core`: status machine, sequence engine (`nextDue`/`dueList`, send-window check),
  template rendering (`fill`/`emailHTML`) ported from the prototype, with vitest coverage
- `apps/api` (Fastify): Supabase-JWT auth, projects/sequence/channels/brand/contacts/
  templates/kb/sources routes, all RLS-backed
- `apps/web` (Next.js 14): Supabase Auth (email link + Google, pending provider enablement),
  project switcher, realtime-subscribed workspace shell; Dashboard, Leads, Sequence, and
  Project settings fully ported; Templates/KB/Channels/Sources/Activity are read-only
  placeholders pending their respective phases (7, 2, 5, 4)
- Seed script loads `seed/elma-project.json` into a demo org
- Verified against the live database: login, project switching, viewer blocked from writes,
  client_viewer scoped to assigned projects only (`packages/db/src/verify-phase1.ts`)

## Implemented (Phase 2 — credential vault + provider connections)

- `packages/db/src/vault.ts`: envelope encryption (AES-256-GCM, per-credential DEK wrapped
  by a master key from `CREDENTIAL_VAULT_MASTER_KEY`), with vitest coverage including a
  regression test for Postgres's `bytea` wire format (a real bug caught by testing against
  the live DB, not just unit tests)
- `packages/providers`: `testConnection` adapters for all 12 providers from the spec
  (Gmail, Microsoft 365, SES, SendGrid, Brevo, SMTP, Meta Cloud API, 360dialog, Gupshup,
  Interakt, AiSensy, Twilio), 41 vitest cases with mocked HTTP; Gmail/Outlook OAuth2
  authorize/exchange/refresh against each provider's documented token endpoint
- `apps/api`: connections CRUD (admin-only via RLS) that tests credentials before
  persisting and never returns encrypted columns to the browser; a separate public
  `/oauth/:provider/callback` (outside the authenticated group, since the browser's
  redirect from Google/Microsoft carries no Authorization header) using an
  **encrypted** `state` param to carry the user's session across that gap
- `apps/web`: Channels page wired to connect (API-key form or OAuth redirect), test,
  and disconnect every provider
- Verified end-to-end against the live Supabase project and the real SendGrid API
  (via `packages/db/src/verify-phase1.ts`-style manual checks): create → encrypt → store
  → retrieve → decrypt → re-test → delete, plus RLS blocking a viewer's write
- **Known gap**: Gmail/Microsoft 365 OAuth is built against each provider's documented
  spec with full unit coverage, but not yet exercised against real Google Cloud /
  Azure App Registration credentials — those don't exist yet. `GOOGLE_OAUTH_CLIENT_ID`
  etc. unset means those two providers respond 503 until configured.

## Implemented (Phase 3 — real sending + scheduler)

- `packages/core`: plain-text email alternative mirroring the HTML footer, RFC 8058
  `List-Unsubscribe`/`List-Unsubscribe-Post` headers, `emailHTML`'s website/WhatsApp
  links now run through an optional `rewriteLink` hook for click tracking
- `packages/providers`: `send()`/`sendTemplate()`/`sendText()` implemented for all 12
  adapters (raw-MIME for Gmail/SES to support custom headers; draft-then-send for
  Outlook since Graph's one-shot `sendMail` returns no id), HMAC-signed open-pixel/
  click-redirect/unsubscribe URL builders, 36 new vitest cases
- `apps/worker` (new): BullMQ scheduler — a 5-minute repeatable tick walks every
  project, applies `nextDue`/send-window/business-day/daily-cap, enqueues sends with
  jitter; send-email and send-whatsapp processors claim their slot via the
  `claim_message_send` Postgres function *before* calling the provider — the real
  idempotency guard, atomically distinguishing "already sent" from "previously
  failed, safe to retry" (a plain insert-and-treat-conflict-as-duplicate, tried
  first, silently broke every retry — see the fix-commit history and the
  function's own migration comment for the full story)
- WhatsApp sends are blocked unless the step's template is `Approved`, with the
  reason recorded in `message_events` (`blocked`) rather than silently dropped
- `apps/api`: manual "Run due steps now" (operator+, bypasses the window but not
  the cap or approval gate) enqueues onto the same queue the scheduler uses; public
  `/t/o/:id` (open pixel), `/t/c/:id` (click redirect), `/u/:id` (unsubscribe, both
  channels) — all fail open (never 404/500 a pixel or trap a click) and record
  events when the signature is valid
- `apps/web`: "Run due steps now" button on the Dashboard
- **Verified live**, not just unit-tested: local Redis + Mailpit + the real Supabase
  project — a lead actually received a real SMTP email with correct subject/body/
  unsubscribe link, advanced `not_contacted → initial_sent`, and a deliberately
  duplicated BullMQ job (different job ID, so BullMQ's own dedup couldn't mask a
  bug) was correctly rejected by the database-level guard with zero duplicate email
  or row. The WhatsApp approval gate was verified the same way — blocked, reason
  recorded, contact left untouched.
- A follow-up full-implementation review caught what that first round of live
  testing missed: the duplicate-job test above proved concurrent/duplicate sends
  were blocked, but never exercised a genuine **failure-then-retry**, which is
  exactly where the original claim logic broke (see `claim_message_send` above).
  Re-verified live with the actual failure scenario: a job given a wrong SMTP
  port burned all 3 attempts and landed on `status='failed'`; a fresh job (the
  next scheduler tick, credentials now corrected) reclaimed the *same* `messages`
  row and sent successfully — one email, zero duplicates. The same review also
  added missing uniqueness constraints that the workers' `.maybeSingle()` calls
  were silently relying on (`provider_connections`: one connected per kind per
  project; `templates`: one per project/channel/step) — both now enforced at the
  database level, not just assumed.
- **Known gaps**: real component/variable mapping for approved WhatsApp templates
  (Meta's numbered `{{1}}` placeholders) ships in Phase 6 — Phase 3 sends approved
  templates as registered, without dynamic parameters. Several WhatsApp adapters
  (360dialog, Gupshup, Interakt, AiSensy) are implemented against documented API
  shapes but unverified against live sandboxes — confirm before a real campaign.
  `apps/worker` needs a paid Render plan (free tier is web-only) and the user's own
  Upstash Redis instance; not yet deployed pending that `REDIS_URL`.

## To be implemented (backend)

- Webhooks → status updates: opens, clicks, bounces, delivered/read receipts, replies, opt-out keywords (Phase 4 — provider-side webhooks; Phase 3 only covers our own open/click/unsubscribe endpoints)
- Live lead sync: OneDrive Excel, Google Sheets, CRMs; webhook and website-form intake
- Meta template submission, approval tracking, and `{{n}}` variable mapping
- Billing and plans (if sold as a product)

## Compliance notes
- Business-initiated WhatsApp messages outside the 24-hour window must use Meta-approved templates.
- Configure SPF, DKIM and DMARC and warm up sending domains before volume email.
