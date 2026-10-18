-- Backfill existing rows written before the invalid_email/invalid_whatsapp
-- split (0016). em_status/wa_status are already channel-scoped columns, so
-- the mapping is unambiguous: any row still holding the old generic
-- 'invalid' in em_status was always about a bad email, and in wa_status was
-- always about a bad phone number.
update contacts set em_status = 'invalid_email' where em_status = 'invalid';
update contacts set wa_status = 'invalid_whatsapp' where wa_status = 'invalid';
