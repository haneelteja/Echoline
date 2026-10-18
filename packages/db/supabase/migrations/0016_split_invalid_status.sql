-- Split the single shared 'invalid' terminal status into channel-specific
-- values so the Leads UI (and any report/export) can say *which* channel is
-- bad instead of a generic "Invalid contact". em_status only ever uses
-- invalid_email; wa_status only ever uses invalid_whatsapp — enforced at the
-- app layer (packages/core/src/status.ts), not by a DB constraint, since
-- Postgres enums can't be split per-column.
--
-- ALTER TYPE ... ADD VALUE cannot be used in the same transaction as a
-- statement that reads the new value, so the enum change and the backfill
-- are separate statements; this file only adds the values. See
-- 0017_backfill_invalid_channel_statuses.sql for the data migration.
alter type contact_channel_status add value if not exists 'invalid_email';
alter type contact_channel_status add value if not exists 'invalid_whatsapp';
