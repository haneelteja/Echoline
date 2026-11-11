-- reply_to_email: per-template override of projects.reply_to_email — lets a
-- specific sequence step route replies to a different inbox than the
-- project's default (e.g. this step's CTA is "reply to this email" and
-- should land with a specific rep). Null means no override, falls back to
-- the project-level reply_to_email, same "absence = off" convention as
-- templates.cc_email.
alter table templates add column reply_to_email text;
