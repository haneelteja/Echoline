# Data model

All data is scoped under `projects/{projectId}`.

| Path | Purpose | Key fields |
|---|---|---|
| `projects/{pid}` | Project | name, brand, senderName, website, waNumber, accent |
| `.../settings/sequence` | Sequence rules | em/wa: {enabled, steps[{delayDays}]}, dailyCap, window{start,end}, stopOnReply |
| `.../settings/channels` | Provider config (no secrets) | email{provider, fromName, fromEmail, replyTo, tracking}, wa{provider, number, phoneId, waba, lang, tracking} |
| `.../settings/brand` | Knowledge base facts | about, offer, pricing, tone, cta, skus[{code,name,size,price,moq}] |
| `.../kb/{id}` | Images and notes | title, assetId?, tags[email\|whatsapp\|logo], text? |
| `.../templates/{id}` | Message templates | channel, step, name, subject, body, categoryLines{category: line}, metaName, metaStatus |
| `.../contacts/{id}` | Leads + status | name, contactPerson, category, area, phone, email, source, em_stage, em_status, em_last, em_track, wa_stage, wa_status, wa_last, wa_track, hist[] |
| `.../sources/{id}` | Lead sources | type, name, config, mode, lastSync, count |
| `.../activity/{YYYY-MM-DD}` | Daily event log | date, events[{t, ch, name, ev}] |

## Status model (per channel)
`not_contacted → initial_sent → fu1_sent → fu2_sent → completed`
Terminal: `replied`, `opted_out`, `invalid`, `bounced`, `failed`.
Delivery tracking: email `sent | opened | clicked | bounced`; WhatsApp `delivered | read | failed`.

## Template placeholders
`{{company}}` `{{contact_name}}` `{{area}}` `{{area_phrase}}` `{{category}}` `{{category_line}}` `{{brand}}` `{{sender_name}}` `{{website}}` `{{whatsapp_number}}`
