-- Relaxes the "one connected provider per kind" safety net (0005) for
-- google_sheets specifically, now that a project can hold several connected
-- Google accounts side by side (apps/api/src/routes/oauthCallback.ts
-- replaces only the same-account row, matched by account_label, instead of
-- evicting any connected row of the kind). Without this, the OAuth
-- callback's insert of a second connected google_sheets row fails outright
-- with a unique-violation (surfaced to the user as oauth_error=storage_failed).
--
-- Every other kind (email, whatsapp, ai, email_imap, onedrive) keeps the
-- original single-connection guarantee — only google_sheets is exempted.
drop index provider_connections_one_connected_per_kind;

create unique index provider_connections_one_connected_per_kind
  on provider_connections (project_id, kind)
  where status = 'connected' and kind <> 'google_sheets';

-- Replaces that same safety net for google_sheets specifically: at most one
-- connected row per (project, account email). NULL account_label rows are
-- exempt by Postgres's own null-distinctness rule, which matches the app
-- layer's fallback behavior (disconnect "any" connected row of the kind)
-- when an account's email couldn't be resolved.
create unique index provider_connections_one_connected_per_google_account
  on provider_connections (project_id, kind, account_label)
  where status = 'connected' and kind = 'google_sheets';
