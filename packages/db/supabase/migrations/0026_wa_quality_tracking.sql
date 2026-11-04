-- Phone number quality/messaging-tier tracking for Meta WhatsApp Cloud API
-- connections. quality_rating (GREEN/YELLOW/RED/NA/UNKNOWN) and
-- messaging_limit_tier (TIER_50.."TIER_UNLIMITED) both live on the Graph
-- API's phone-number object (GET /{phone-number-id}?fields=quality_rating,
-- messaging_limit_tier) — confirmed against Meta's Graph API phone-number
-- field reference. Neither is Meta-specific in column name only by
-- necessity: 360dialog/Twilio don't expose an equivalent in a confirmed,
-- documented way, so this starts Meta-only and these columns are simply
-- left null for every other provider.
alter table provider_connections add column wa_quality_rating text;
alter table provider_connections add column wa_messaging_tier text;
alter table provider_connections add column wa_quality_checked_at timestamptz;
