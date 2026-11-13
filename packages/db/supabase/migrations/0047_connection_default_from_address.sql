-- Lets an admin pick which of a connection's configured from_addresses is
-- the primary one — used as the fallback From when a template hasn't
-- explicitly chosen an address itself. Previously that fallback silently
-- used credentials.fromEmail (whatever was typed once at connect time,
-- never editable again afterward), which is why adding more addresses to
-- from_addresses had no visible effect on unassigned templates.
alter table provider_connections add column default_from_address text;
