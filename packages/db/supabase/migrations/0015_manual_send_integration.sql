-- "Send now" used to be fully decoupled from the sequence engine (no
-- contacts.em_stage/wa_stage update, no messages row) so a manual send could
-- never collide with the scheduler's own bookkeeping. Per product decision,
-- a manual send should now count as that step actually happening: it claims
-- the same messages row via claim_message_send (0004), advances
-- em_stage/wa_stage like an automated send, and counts toward the daily cap
-- — so the scheduler naturally continues with the next follow-up afterward
-- instead of the lead being stuck.
--
-- These two columns are a lightweight "was the most recent send for this
-- channel manual or automated" marker for the Leads table — distinct from
-- em_track/wa_track, which track delivery status (sent/opened/clicked/
-- bounced), not who/what triggered the send.
alter table contacts add column em_manual_last boolean not null default false;
alter table contacts add column wa_manual_last boolean not null default false;
