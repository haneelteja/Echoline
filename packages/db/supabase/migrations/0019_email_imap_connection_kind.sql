-- A dedicated connection kind for reading a reply inbox via IMAP, distinct
-- from 'email' (the sending identity) — a project needs both at once (one
-- sends, the other watches for replies), and 'email' is a singleton-per-
-- project kind that would otherwise get replaced by adding this.
alter type connection_kind add value 'email_imap';
