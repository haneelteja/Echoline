-- Exempt 'email' from the one-connected-per-kind constraint, same way
-- 'google_sheets'/'ai' already are (0024/0032) — needed for Gmail/Outlook
-- users to connect a second mailbox, and so a Resend connection carrying
-- multiple from_addresses can coexist with other connected email rows.
-- 'whatsapp'/'email_imap' are untouched — still one active connection each.
drop index provider_connections_one_connected_per_kind;
create unique index provider_connections_one_connected_per_kind
  on provider_connections (org_id, kind)
  where status = 'connected' and kind not in ('google_sheets', 'ai', 'email');

-- Only meaningful for API-key email providers (Resend/SES/SendGrid/Brevo/
-- SMTP) — Gmail/Outlook ignore this, their "from" is the authenticated
-- mailbox regardless. Admin-managed list of addresses this connection's
-- verified domain can send as.
alter table provider_connections add column from_addresses text[];

-- Null from_connection_id = "fall back to whichever single email
-- connection is connected" (today's behavior, still correct as long as
-- exactly one is connected). Once a second is connected, sending with no
-- from_connection_id set becomes genuinely ambiguous — see apps/worker/src/
-- workers/emailWorker.ts's resolution logic.
alter table templates add column from_connection_id uuid references provider_connections(id) on delete set null;
alter table templates add column from_email text;

-- Versioned alongside cc_email/reply_to_email — every content-affecting
-- save already snapshots into template_versions (see
-- apps/api/src/routes/templateVersions.ts's contentFields()), and a
-- template's From choice is exactly that kind of content.
alter table template_versions add column from_connection_id uuid references provider_connections(id) on delete set null;
alter table template_versions add column from_email text;
