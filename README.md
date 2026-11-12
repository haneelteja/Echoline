# Echoline

Multi-project **email + WhatsApp push outreach** portal. It replaces the Elma Industries Make.com scenario with a project-based workspace: knowledge base, AI-written templates, multi-step sequences, per-channel status tracking and an analytics dashboard.

## Repository layout

| Path | What it is |
|---|---|
| `apps/web` | Next.js 14 (App Router) frontend — deployed on Vercel. |
| `apps/api` | Fastify API — deployed on Render. |
| `apps/worker` | BullMQ scheduler/send-queue worker — deployed on Render. |
| `packages/core`, `packages/db`, `packages/providers` | Shared logic, Supabase schema/migrations, and email/WhatsApp/AI provider adapters. |
| `docs/DATA_MODEL.md` | Collections, fields and status model. |
| `docs/ROADMAP.md` | What's built and what's still planned. |
| `seed/elma-project.json` | Elma Industries project config: sequence, channels, brand/SKUs, templates and the OneDrive source, migrated from the Make scenario — read by `packages/db/src/seed.ts`. |

## Stack

Next.js 14 (web) · Fastify (API) · Supabase Postgres (+ Auth, Realtime) · BullMQ / Redis (scheduler and send queues) · Anthropic Claude and other providers via an AI router (template generation and insights).

## Status

See [`docs/ROADMAP.md`](docs/ROADMAP.md).
