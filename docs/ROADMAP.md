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

## To be implemented (backend)
- Provider adapters. Email: Gmail, Microsoft 365, SES, SendGrid, Brevo, SMTP. WhatsApp: Meta Cloud API, 360dialog, Gupshup, Interakt, AiSensy, Twilio
- Encrypted credential vault per project (OAuth tokens, API keys)
- BullMQ scheduler that runs due steps inside the send window
- Webhooks → status updates: opens, clicks, bounces, delivered/read receipts, replies, opt-out keywords
- Live lead sync: OneDrive Excel, Google Sheets, CRMs; webhook and website-form intake
- Meta template submission and approval tracking
- Auth, roles, per-client access
- Billing and plans (if sold as a product)

## Compliance notes
- Business-initiated WhatsApp messages outside the 24-hour window must use Meta-approved templates.
- Configure SPF, DKIM and DMARC and warm up sending domains before volume email.
