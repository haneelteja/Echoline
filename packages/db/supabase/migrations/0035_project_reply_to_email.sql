-- Lets a project send branded outreach email from one address (good for
-- deliverability — a verified domain) while routing replies to a different,
-- already-working inbox the team actually monitors. Null means "no override,
-- replies go to the From address" (packages/providers/src/email/*.ts only
-- sets Reply-To when this is present).
alter table projects add column reply_to_email text;
