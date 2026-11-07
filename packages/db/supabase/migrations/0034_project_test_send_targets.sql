-- Lets the platform operator configure, per project, which inbox/number test
-- sends are redirected to (apps/api & apps/worker's testSendMode.ts), instead
-- of only the hardcoded pega2023test@gmail.com / 9642917777 fallback. Null
-- means "use the hardcoded fallback" — same two-key safety-valve pattern as
-- 0033_project_test_send_mode.sql, just for the destination rather than the
-- on/off switch.
alter table projects add column test_send_email text;
alter table projects add column test_send_whatsapp text;
