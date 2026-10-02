-- Atomic idempotency claim for Phase 3 sending.
--
-- The naive approach (plain INSERT, treat any unique-constraint conflict as
-- "already sent, skip") breaks retries: once a send fails, its `messages` row
-- sits at status='failed', and every retry attempt's claim-insert hits that
-- same row and is wrongly treated as a duplicate — the job reports success to
-- BullMQ without ever actually sending. This function distinguishes "already
-- sent" (true no-op) from "previously failed" (safe to reclaim and retry) in
-- one atomic statement, so two concurrent callers can never both win.
create or replace function claim_message_send(
  p_org_id uuid,
  p_project_id uuid,
  p_contact_id uuid,
  p_channel channel_kind,
  p_step int
) returns messages
language plpgsql
as $$
declare
  result messages;
begin
  insert into messages (org_id, project_id, contact_id, channel, step, status)
  values (p_org_id, p_project_id, p_contact_id, p_channel, p_step, 'queued')
  on conflict (project_id, contact_id, channel, step)
  do update set status = 'queued', updated_at = now()
  where messages.status = 'failed'
  returning * into result;

  if result.id is null then
    return null;
  end if;
  return result;
end;
$$;

comment on function claim_message_send is
  'Atomically claims a send slot for (project,contact,channel,step): inserts fresh, or reclaims a row stuck at ''failed''. Returns null if another attempt already holds or completed this slot (status ''queued'' or ''sent''). The sole idempotency authority for Phase 3 sending — BullMQ job IDs are not relied on for dedup.';
