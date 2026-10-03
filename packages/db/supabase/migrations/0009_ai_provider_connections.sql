-- Phase 7: AI features need a pluggable provider (Anthropic/OpenAI/Gemini),
-- configured per-project the same way email/WhatsApp providers already are —
-- so this reuses provider_connections/the credential vault rather than
-- inventing a parallel mechanism. connection_kind needs a third value.
alter type connection_kind add value 'ai';
