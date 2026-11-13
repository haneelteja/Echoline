-- intake.ts/sourceSync.ts both discard an email/phone that fails
-- validEmail()/normPhone() at contact-creation time, storing null in
-- email/phone instead of whatever raw value was actually sent — so by the
-- time the scheduler later logs an "Invalid" event for that contact, the
-- original value is already gone with nothing to show for it. These two
-- columns are purely diagnostic (never read by anything that sends) —
-- populated only when the real column ends up null because the raw value
-- failed validation, so what was actually attempted stays visible.
alter table contacts add column raw_email text;
alter table contacts add column raw_phone text;
