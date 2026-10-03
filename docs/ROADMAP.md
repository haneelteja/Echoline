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

## Implemented (Phase 4 — provider webhooks: delivery, bounces, replies, opt-out)

- `packages/providers/src/webhooks/verify.ts`: signature verification for Resend (Svix HMAC), SendGrid
  (ECDSA Signed Event Webhook), Meta Cloud API (HMAC-SHA256 app secret), and Twilio (HMAC-SHA1 over the
  full URL + sorted params) — 16 vitest cases covering valid, tampered, and malformed-header inputs
- `apps/api/src/routes/webhooks.ts`: public routes (outside `/v1` auth, same as tracking) for each
  provider; an unverified or unrecognized request always gets a 200 (never retry-storms the provider)
  but writes nothing
  - **Resend**: per-connection webhook secret — the payload's `email_id` maps to exactly one
    message → project → connection, so the right secret is resolved before trusting anything else in
    the payload. `delivered`/`bounced`/`complained` map to `messages.status` + a terminal
    `contacts.em_status` (bounced → `bounced`, complained → `opted_out` on both channels)
  - **SendGrid**: signs its whole batch POST as one unit (not per-message), so unlike Resend there's
    no single connection to resolve a key from before verifying — assumes one account's verification
    key per deployment (`SENDGRID_WEBHOOK_VERIFICATION_KEY`), same pattern as
    `CREDENTIAL_VAULT_MASTER_KEY`/`META_APP_SECRET`. Revisit if multiple SendGrid-connected projects
    ever need independent keys.
  - **Meta WhatsApp Cloud API**: `GET` handshake (`hub.challenge`) plus signed `POST` events; one Meta
    App receives webhooks for every WABA number subscribed to it, so the app secret
    (`META_APP_SECRET`) is global, not per-connection. Delivery/read statuses update `messages`;
    inbound messages resolve the owning project by matching `metadata.display_phone_number` against
    `projects.wa_number`, then the contact by phone
  - **Twilio**: per-connection auth token, resolved via the project whose `wa_number` matches either
    `From` (status callbacks, about our own sent message) or `To` (inbound messages)
  - Inbound WhatsApp replies (Meta + Twilio) set `wa_status: replied` unless the message body is an
    opt-out keyword (stop/unsubscribe/cancel/end/quit/opt out), in which case both channels go to
    `opted_out` — mirroring the existing unsubscribe-link flow. `packages/core`'s `dueList` already
    treats `replied`/`opted_out` as terminal on either channel (respecting `stopOnReply`), so no
    sequence-engine changes were needed.
  - Brevo, SES, Gmail, Outlook, 360dialog, Gupshup, Interakt, AiSensy: stubbed to 200 (acknowledged,
    no-op) — built out when first actually used for a live campaign, same pattern as Phase 2's
    unconfigured Google/Microsoft OAuth.
- Fixed a related gap found while building this: `messages.provider_connection_id` existed in the
  schema since Phase 1 but was never actually set by either worker — webhooks need it to resolve the
  right connection's secret, so both `emailWorker.ts` and `whatsappWorker.ts` now populate it on send.
- New index (`0007_messages_provider_message_id_idx.sql`): webhooks look up messages by the
  provider's own message ID, not ours.
- No data model or status-name changes — `message_events.event_type` was already free text and both
  `messages.status` and `contact_channel_status` already had every value this phase needed, defined
  back in Phase 1.
- **Verified live**: a real Resend webhook endpoint pointed at `echoline-api`, with its signing secret
  set as the `webhookSecret` credential on the Elma project's Resend connection — a fresh send's
  `messages.status` correctly advanced `sent → delivered` driven entirely by the real,
  Svix-signature-verified `email.delivered` webhook, with `message_events` recording the full real
  chain (`sent` → Resend's `email.sent` → `delivered`). Meta/Twilio/SendGrid remain unit-tested only,
  since no WhatsApp provider or SendGrid account is connected yet.

## To be implemented (backend)

- Email reply detection: no inbound-email infrastructure exists (Resend has no inbound-parse product;
  would need SendGrid Inbound Parse or a dedicated mailbox) — WhatsApp replies are covered, email
  replies are not yet.
- Live lead sync: OneDrive Excel, Google Sheets, CRMs; webhook and website-form intake
- Meta template submission, approval tracking, and `{{n}}` variable mapping
- Billing and plans (if sold as a product)

## Compliance notes
- Business-initiated WhatsApp messages outside the 24-hour window must use Meta-approved templates.
- Configure SPF, DKIM and DMARC and warm up sending domains before volume email.
