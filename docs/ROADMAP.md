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

## Implemented (Phase 5 — webhook & website-form lead intake)

- `apps/api/src/routes/sources.ts`: `POST /v1/projects/:id/sources/:sourceId/token` issues (or
  rotates) a bearer token for a `webhook`/`form`-type lead source — only its SHA-256 hash is stored
  (`lead_sources.config.tokenHash`), the plaintext is returned once, same pattern as any API-key
  issuance flow. Runs through the caller's own RLS (`can_write_project`), no bespoke role check needed.
- `apps/api/src/routes/intake.ts`: public `POST /intake/:sourceId` (outside `/v1` auth — no Supabase
  session from an external form/webhook caller), token-authenticated via the hash above. Accepts both
  JSON and `application/x-www-form-urlencoded` (a plain HTML `<form>` can't set a custom
  `Authorization` header, so the token may ride in `?token=` instead for that case). De-dup matches
  the original prototype's Excel/CSV import rule exactly: same email or phone as an existing contact
  in the project is skipped, and an existing contact's status is never overwritten by a re-synced
  source.
- `apps/web`'s Sources page: create a webhook/form source, generate/rotate its token, and see the
  exact `POST` URL + auth instructions to hand to whoever owns the website form or webhook sender.
- Scope decision (asked and confirmed): OneDrive Excel and Google Sheets sync need OAuth app
  credentials that don't exist yet (same gap as Gmail/Outlook email since Phase 2) — not built this
  phase. No specific CRM was named, so generic "CRM sync" wasn't buildable either. Both remain in
  the "to be implemented" list below.
- No data model changes — reuses `lead_sources.config` (already schemaless jsonb) for the token hash.
- **Verified live** against the deployed `echoline-api`: a valid JSON webhook post created a contact
  (201), a form-urlencoded post with the token in the query string (simulating a plain HTML `<form>`)
  also created a contact (201), a second post with the same email correctly skipped as a duplicate
  (200, no new row) while still recording it in `rows_skipped`, and a request with a wrong token was
  rejected (401). The source's `rows_added`/`rows_skipped` counters matched exactly (2/1).

## Implemented (Phase 6 — Meta WhatsApp template submission, approval tracking, variable mapping)

- `packages/core`: `deriveMetaTemplateComponents(body)` scans a template body for our own
  `{{placeholder}}` tokens and returns both the Meta-numbered body text (`{{1}}`, `{{2}}`, ...) and
  the ordered `variableMap` of placeholder keys — derived automatically from the existing body, not
  hand-authored, so there's no separate "define your variable mapping" UI to build. A repeated
  placeholder gets its own position (Meta requires a slot per occurrence even if the value repeats);
  an unknown `{{typo}}` is left as literal text rather than silently mis-submitted. 4 new vitest cases.
- `packages/providers`: `submitMetaTemplate()` — `POST /{wabaId}/message_templates`. Needs a new
  `wabaId` credential (template management is WABA-level, not phone-number-level like sending), added
  as an optional field on the Meta connection form. 3 new vitest cases.
- `apps/api/src/routes/waTemplates.ts`: `POST /v1/projects/:id/templates/:templateId/submit-whatsapp`
  — derives the variable map from the template's current body, submits to Meta, and upserts a
  `wa_templates` row (one per template, enforced by a new unique constraint) plus mirrors the status
  onto `templates.meta_status`, the field the worker actually gates sends on. Gated to org-admins
  (not just operators) for the same reason `connections.ts` is: it reads the project's connected Meta
  credentials, and `provider_connections` is admin-only via RLS. Runs entirely through the caller's
  own RLS context — no admin-client bypass needed, since an admin already has both the connection-read
  and templates-write access this needs.
- `apps/api/src/routes/webhooks.ts`: extended the existing Meta webhook handler for
  `message_template_status_update` events (approved/rejected, with Meta's rejection reason) — these
  are WABA-level, not phone-number-level, so the project is resolved by decrypting each Meta
  connection's credentials to match `wabaId` against the webhook's `entry.id` (same pragmatic
  decrypt-and-compare approach as Phase 4's WABA-number resolution; fine at today's connection count).
- `apps/worker/src/workers/whatsappWorker.ts`: now reads the submitted template's `variable_map` and
  rebuilds the right positional component parameters from live contact/project context via `fill()`
  at send time — a template with no variables sends with no components exactly as before, so this is
  backward compatible with everything already sent in Phase 3.
- New migration (`0008_wa_templates_variable_map.sql`): `wa_templates.variable_map jsonb`, plus a
  unique constraint on `template_id` (confirmed and asked about before building, since it's a schema
  change).
- Deliberately **not** added: a "Submit to Meta" button in `apps/web`. The Templates page is still the
  explicit read-only placeholder it's been since Phase 1 ("Editing and AI generation ship in Phase
  7") — adding a one-off submission button there would cut across where the real template-editing UI
  belongs. The backend is fully ready; the UI trigger is deferred to Phase 7's editor.
- **Not yet verified live**: unit-tested only. No Meta WhatsApp Business Account is connected (same
  gap noted since Phase 4), so submission and the approval webhook can't be exercised against the
  real Meta API yet.

## Implemented (Phase 7 — AI template generation/rewrite, template editor)

- Asked and confirmed before building: the original prototype's AI features ran through a
  claude.ai-Artifacts-specific mechanism (`S.sample.json(...)`, "runs on your Claude account"), which
  doesn't exist in this standalone deployment. Rather than hardcode one real API (e.g. Anthropic), the
  AI provider is pluggable — Anthropic/OpenAI/Gemini, chosen and configured per-project, same as every
  email/WhatsApp provider already is.
- Data model change (confirmed before building, consistent with the project's own rule):
  `connection_kind` gained a third value, `'ai'` (`0009_ai_provider_connections.sql`). AI credentials
  reuse `provider_connections`/the credential vault rather than inventing a parallel mechanism —
  `apps/web`'s Channels page now has a third section (Email / WhatsApp / AI) using the exact same
  connect/test/disconnect flow.
- `packages/providers/src/ai/{anthropic,openai,gemini}.ts`: `testConnection` + a generic
  `complete(credentials, {system, user, maxTokens}) => string` per provider — returns the raw text
  completion; JSON parsing/validation is the caller's job, same division of responsibility the
  prototype's own `S.sample.json()` callers had. 16 new vitest cases.
- `apps/api/src/routes/aiTemplates.ts`: `POST /v1/projects/:id/templates/ai-generate` and
  `POST /v1/projects/:id/templates/:templateId/ai-rewrite` — same knowledge-base context format and
  prompts as the original prototype's `kbContext()`/`aiGenerate()`/`aiRewrite()`, ported to call a
  real provider instead of the artifact's sample API. A loose JSON parser strips a ` ```json ` fence
  if the model wrapped its output in one despite being asked for JSON only. Gated to org-admins, same
  reasoning as Phase 6's template submission: reads `provider_connections`, which is admin-only RLS.
- `apps/web`'s Templates page is no longer the Phase 1 read-only placeholder: full editor (name,
  subject, body, default category line) with a live preview — real `emailHTML()` rendering for email,
  a WhatsApp-bubble-styled `fill()` preview for WhatsApp — "Generate with AI" (goal/steps/extra) and
  "Rewrite with AI" (freeform instruction) actions, and for WhatsApp templates, the Meta
  name/category inputs plus the **Phase 6 "Submit to Meta" button**, deferred specifically until this
  editor existed.
- **Not yet verified live**: unit-tested only (the AI adapters' signature/parsing logic). No AI
  provider is connected yet — needs a real Anthropic/OpenAI/Gemini API key to exercise generation and
  rewrite end-to-end.

## Fixed outside the 8-phase plan

- Activity page was still Phase 1's dead-stub placeholder despite Phases 3-4 (sends + webhooks) having
  been live for a while, with no way to actually see the opens/clicks/deliveries/bounces/replies
  already being recorded. `GET /v1/projects/:id/activity` (read-only — `message_events` has no
  update/delete RLS policy, deliberately not in `collections.ts`'s generic CRUD list) plus a real page
  with cursor-based "load more" pagination and its own live realtime subscription. **Verified live**
  against the deployed API with a real session: correct newest-first ordering, correct contact-name
  join, correct payload data, on the Phase 3/4 smoke-test fixture's real events.
- Found and fixed during a "double check the whole implementation" pass: migration `0008`
  (`wa_templates.variable_map` + its unique constraint) had never actually been applied to production,
  despite `0007` and `0009` being applied correctly — Phase 6/7's WhatsApp template submission and
  send-time variable substitution were silently broken until this was caught and fixed.
- Rebuilt the Dashboard to actually use the rich design system (`.hero`, concentric-ring SVG,
  channel funnel bars, insights, 14-day send trend, 7-day schedule, segment heat table, data health,
  areas) that already existed in `globals.css`, ported from the prototype, but was never wired up —
  the Next.js rebuild's Dashboard had been a bare stat-box grid since Phase 1. No backend changes
  needed (`dueList`/`upcomingList`/`validEmail`/`normPhone` were already exported from
  `packages/core`); the 14-day trend reuses the Phase-4 activity endpoint.
- A line-by-line audit against the original spec (not just prior review passes) found and fixed five
  real gaps:
  - **OAuth token refresh was dead code.** `refreshGoogleToken`/`refreshMicrosoftToken` existed in
    `packages/providers` but were never called anywhere — any Gmail/Outlook connection would have
    silently started failing once its first access token expired (~1 hour). `emailWorker.ts` now
    refreshes unconditionally before every OAuth send (simpler and safer than tracking expiry
    ourselves) and persists the result, marking the connection `needs_reconnect` with a reason if the
    refresh itself fails. `echoline-worker` needs the same `GOOGLE_OAUTH_CLIENT_ID`/
    `MICROSOFT_OAUTH_CLIENT_ID` env vars `echoline-api` already has — added to `render.yaml`.
  - **Meta template submissions were missing `example.body_text`.** Meta's template API generally
    requires an example value per variable for review, which we never sent — likely causing silent
    rejection/indefinite hold for any template with placeholders. `deriveMetaTemplateComponents` now
    also returns a matching `examples` array (a static example-value map keyed by placeholder, e.g.
    `company` → `"Acme Corp"`), threaded through `submitMetaTemplate` → `waTemplates.ts`.
  - **Hard bounces weren't distinguishing `invalid` from `bounced`.** The spec calls for hard
    bounce → contact email `invalid` specifically (both are valid terminal statuses, already in the
    schema since Phase 1) so the sequence stops retrying a genuinely dead address. Resend: checks
    `data.bounce.type === "Permanent"`. SendGrid: their `bounce` event is specifically their
    hard-bounce signal (soft/temporary issues arrive as a separate `blocked`/`deferred` event), so it
    now maps directly to `invalid`.
  - **No error monitoring anywhere.** `SENTRY_DSN` was an unused placeholder — zero Sentry
    integration existed in either service. Added a no-op-until-configured `sentry.ts` to both
    `apps/api` (Fastify error handler, for 5xx only — not validation 400s — plus
    `unhandledRejection`) and `apps/worker` (every BullMQ worker's `failed` handler, but only once a
    job has exhausted all retries, so a transient failure that succeeds on retry 2 doesn't page
    anyone for retry 1's failure). **Verified live** on `echoline-api`: a deliberate thrown error was
    correctly captured with full stack trace, production environment, and the exact deploying commit
    SHA as the release tag. `echoline-worker` runs the identical code path but wasn't separately
    live-triggered (would mean forcing a real job through all 5 retries rather than one HTTP call).
  - **Corrected my own earlier scoping error**: Phase 5 was scoped as "no CRM named" when deciding
    what to build — the original spec actually names **Zoho CRM and HubSpot** specifically. Not
    built yet; moved below as a named gap instead of an unscoped one.

## Backlog progress

- **360Messenger — new WhatsApp provider, user-requested.** Not from the original spec's provider
  list — the user has a live account and asked for it directly. Distinct from "360dialog" (already
  built) despite the similar name: 360Messenger (`360messenger.com`) is an **unofficial
  WhatsApp-Web-automation service** sending from a personal number, not an official WhatsApp Business
  number — confirmed with the user before building, since this changes how it has to be wired in.
  No Meta template-approval system exists for it at all, so `packages/providers/src/types.ts` gained
  `TEXT_ONLY_WHATSAPP_PROVIDERS`, a set the worker checks to skip the "cold sends need an Approved
  template" gate entirely for this provider and send the template body as free-form text instead —
  this also means `sendText()`/`WhatsAppTextSender` (previously dead code, flagged as unused in the
  spec audit) is now actually wired up, as 360Messenger's *primary* send path rather than just a
  24h-reply-window fallback the way Meta/Twilio use it. 7 new vitest cases, including one that caught
  a real bug before it shipped: an initial `/connected|authenticated|open/i` regex check on the
  WhatsApp Web session state would have wrongly treated `"DISCONNECTED"` as healthy, since it contains
  `"CONNECTED"` as a substring — fixed to an exact (case-insensitive) match instead.
  **Not live-verified**: no API docs/sample payloads were available beyond endpoint names and auth
  headers, so the exact request/response field names for `/v2/sendMessage/` and `/v2/client/getState/`
  are a best-effort guess, clearly flagged in code comments — needs testing against the user's live
  account (they're connecting it directly via the Channels page, not sharing the key in chat).
- **Dead-letter mechanism — done, different shape than literally "a BullMQ DLQ."** A single send job
  already retries 5x with exponential backoff, and the next 5-minute scheduler tick already retries a
  `failed` message automatically (via `claim_message_send`'s reclaim logic, live-verified in Phase 3)
  — so a *separate* BullMQ dead-letter queue would mostly duplicate what `message_events` already
  records durably. The actual gap: nothing stopped that tick-level retry from repeating forever for a
  contact whose failure is permanent (bad credentials nobody's fixed), which meant an effective
  infinite retry loop — a fresh Sentry alert every 5 minutes, indefinitely, with no way to say "stop,
  a human needs this." `apps/worker/src/deadLetter.ts`: after 3 separate scheduler-tick-level
  exhaustions for the same contact+channel+step, the contact's status moves to the existing terminal
  `failed` status (`nextDue()`/`dueList()` already treat terminal statuses as "stop offering this," so
  no sequence-engine changes needed), with a distinct `dead_letter` event for visibility in the
  Activity log (now has its own label/color there: "Gave up — needs review").
- **"Ask AI" dashboard insights — done.** `POST /v1/projects/:id/insights/ai` — same prompt/shape as
  the original prototype's "Ask AI" button, but the dashboard sends whatever stats it's already
  computed client-side rather than the server recomputing them from scratch (avoids two places that
  could drift out of sync on what "engaged" or "reached" means). Gated to org-admins, same
  `provider_connections`-read reasoning as template generation/rewrite.
- **SES bounce/complaint/delivery webhook — done.** `verifySnsSignature`/`isValidSnsCertUrl` in
  `packages/providers/src/webhooks/verify.ts`: validates the `SigningCertURL` is genuinely AWS's
  (`sns.<region>.amazonaws.com`, https only — guards against a forged cert URL) before fetching and
  checking the X.509-signed canonical string (SignatureVersion 1 = SHA1, 2 = SHA256). Auto-confirms
  the SNS subscription handshake. Hard bounce → `invalid`, soft → `bounced`, complaint → `opted_out`
  both channels — same convention as Resend/SendGrid. 11 new vitest cases against a locally-generated
  self-signed test cert (verifies our canonical-string construction and crypto are internally
  consistent; not a real AWS cert, so still unverified against a live SES/SNS account). Also fixed:
  SNS POSTs `Content-Type: text/plain` instead of `application/json` (a known AWS quirk), which our
  content-type parsers didn't handle before this.
- **360dialog webhook — done, confidence caveat.** Parses the flat (On-Premise-API-style, not Meta's
  nested entry/changes) `{messages, statuses}` shape, consistent with the existing `send360DialogTemplate`
  adapter's `v1/messages` endpoint. 360dialog doesn't publish a standard HMAC webhook signature; checks
  an optional shared-secret header (`D360-Webhook-Secret`) against the connection's own `webhookSecret`
  credential instead, same per-connection-secret pattern as Resend. **Needs confirmation against a live
  360dialog account** before relying on it for a real campaign — flagged honestly rather than guessed
  with false confidence.
- **Gupshup/Interakt/AiSensy webhooks — intentionally still stubbed.** Unlike 360dialog (a documented
  Meta-API-compatible wrapper, and this codebase's own `send*Template` adapters already establish
  their request shapes with reasonable confidence), I don't have high-confidence knowledge of these
  three providers' exact webhook payload schemas. Implementing them from uncertain memory risked
  shipping webhook handlers that silently never match real payloads — worse than an honest stub, since
  it would look done without being correct. Left stubbed; happy to build these out either against
  their live docs or sample payloads if you want to prioritize one.
- **Website-form bot protection — done.** `/intake/:sourceId` now rate-limits to 20 submissions/minute
  per source+IP (`@fastify/rate-limit`, in-memory — fine for Render's single-instance free/starter
  plans, would need a shared store if ever scaled to multiple instances) and accepts an optional
  honeypot field (`website_url`, left empty by real visitors) that silently no-ops instead of creating
  a contact. Cloudflare Turnstile itself needs a sitekey/secret you'd have to obtain — not built.
- **`lead_sources.rows_failed` — done.** Now actually incremented on a missing-name validation failure
  or a DB insert error, not just defined-but-unused.
- Email reply detection: no inbound-email infrastructure exists (Resend has no inbound-parse product;
  would need SendGrid Inbound Parse or a dedicated mailbox; spec also called for Gmail history
  API/watch, Microsoft Graph delta/subscriptions, and IMAP polling for SMTP) — WhatsApp replies are
  covered, email replies are not yet. This also means "stop on reply" only works for WhatsApp today.
- OneDrive Excel / Google Sheets scheduled sync: needs Microsoft/Google OAuth app credentials
  (`GOOGLE_OAUTH_CLIENT_ID`/`MICROSOFT_OAUTH_CLIENT_ID`), still unset.
- Zoho CRM and HubSpot sync — named in the original spec, not built.
- Per-provider rate limiting (beyond the existing daily cap) — not implemented.
- `sendText()` (session-window free-form WhatsApp replies) — the function exists in
  `packages/providers` but no feature in the app actually calls it.
- Meta template header-image attachment from KB, daily status poll (webhook-only currently), and
  phone number quality-rating/messaging-tier tracking (a different webhook event,
  `phone_number_quality_update`, never handled) + display on the Channels screen — not built.
- Real pgvector KB retrieval — `kb_items.embedding` column exists, nothing populates or queries it;
  current AI context-building is plain string concatenation, not vector similarity search.
- Per-org monthly AI usage limit — not enforced.
- Billing and plans (if sold as a product)

## Compliance notes
- Business-initiated WhatsApp messages outside the 24-hour window must use Meta-approved templates.
- Configure SPF, DKIM and DMARC and warm up sending domains before volume email.
