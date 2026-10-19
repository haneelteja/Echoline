-- A project-level contact email, alongside the existing wa_number — both are
-- read by the Email & WhatsApp "Test" dialog (channels/page.tsx) to prefill
-- the test recipient, so the admin doesn't have to type it in every time.
alter table projects add column email text;
