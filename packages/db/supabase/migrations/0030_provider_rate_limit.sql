-- Per-connection send-rate cap, independent of sequence_settings.daily_cap
-- (that bounds total volume/day; this bounds burst speed/minute, to avoid
-- tripping a provider's own abuse detection). Nullable: null means "no
-- explicit override", which falls back to a provider-specific default
-- enforced in code (apps/worker/src/rateLimit.ts, apps/api/src/rateLimit.ts)
-- — currently only set for 360Messenger, since it's unofficial
-- WhatsApp-Web automation, not the real Business API. No UI control yet;
-- set directly here if you want to cap a specific connection.
alter table provider_connections add column max_sends_per_minute int;
