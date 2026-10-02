# Echoline

Multi-project **email + WhatsApp push outreach** portal. It replaces the Elma Industries Make.com scenario with a project-based workspace: knowledge base, AI-written templates, multi-step sequences, per-channel status tracking and an analytics dashboard.

## Repository layout

| Path | What it is |
|---|---|
| `app/index.html` | Front-end prototype (single file, vanilla JS). Runs inside Claude Artifacts using its `db`, `assets`, `sample` (AI) and `user` capabilities. |
| `docs/DATA_MODEL.md` | Collections, fields and status model. |
| `docs/ROADMAP.md` | What's built and what the backend still needs. |
| `seed/elma-project.json` | Elma Industries project config: sequence, channels, brand/SKUs, templates and the OneDrive source, migrated from the Make scenario. |

## Running the prototype
The page needs the Claude Artifact runtime (`window.claude.use(...)`). Outside it, the page shows an "Open this page in Claude" notice. For production, replace the `db` / `assets` / `sample` calls with the backend APIs.

## Target production stack
Next.js 14 (web) · Fastify (API) · Supabase Postgres + pgvector · BullMQ / Redis (scheduler and send queues) · Anthropic Claude (template generation and insights).

## Status
See [`docs/ROADMAP.md`](docs/ROADMAP.md).
