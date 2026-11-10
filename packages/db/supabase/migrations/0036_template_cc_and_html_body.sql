-- cc_email: CCs a fixed address on every send of this template (e.g. a sales
-- rep who wants visibility into outreach sent under their name). Null means
-- no CC, same "absence = off" convention as projects.reply_to_email.
alter table templates add column cc_email text;

-- body_is_html: when true, `body` is already a complete HTML fragment the
-- user wrote by hand (e.g. a custom CTA button) and is sent close to as-is
-- (after {{placeholder}} substitution) instead of being auto-wrapped as
-- plain-text paragraphs by emailHTML(). Defaults false so every existing
-- template keeps rendering exactly as before.
alter table templates add column body_is_html boolean not null default false;
