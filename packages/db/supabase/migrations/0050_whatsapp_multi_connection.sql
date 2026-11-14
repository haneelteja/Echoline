-- Exempt 'whatsapp' from the one-connected-per-kind constraint, same way
-- 'email' already is (0046) — needed so a second WhatsApp provider (e.g.
-- Meta Cloud API alongside 360Messenger) can stay connected at once, with
-- each WhatsApp template choosing its own From connection via the same
-- templates.from_connection_id column already added for email.
drop index provider_connections_one_connected_per_kind;
create unique index provider_connections_one_connected_per_kind
  on provider_connections (org_id, kind)
  where status = 'connected' and kind not in ('google_sheets', 'ai', 'email', 'whatsapp');
