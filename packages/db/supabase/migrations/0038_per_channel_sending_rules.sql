-- Daily cap and send window become per-channel (email and WhatsApp often need
-- different cadences/hours) instead of one shared pair of project-wide
-- values. They live inside the existing em/wa jsonb config, same as the
-- existing enabled/steps fields, rather than new columns.
alter table sequence_settings
  alter column em set default '{"enabled":true,"dailyCap":50,"window":{"start":"10:00","end":"18:00"},"steps":[{"delayDays":0},{"delayDays":2},{"delayDays":5}]}',
  alter column wa set default '{"enabled":true,"dailyCap":50,"window":{"start":"10:00","end":"18:00"},"steps":[{"delayDays":0},{"delayDays":2},{"delayDays":5}]}';

-- Backfill existing rows from the old shared columns so no project's
-- behavior changes the moment this migration runs.
update sequence_settings
set
  em = em || jsonb_build_object(
    'dailyCap', daily_cap,
    'window', jsonb_build_object('start', to_char(window_start, 'HH24:MI'), 'end', to_char(window_end, 'HH24:MI'))
  ),
  wa = wa || jsonb_build_object(
    'dailyCap', daily_cap,
    'window', jsonb_build_object('start', to_char(window_start, 'HH24:MI'), 'end', to_char(window_end, 'HH24:MI'))
  )
where not (em ? 'dailyCap') or not (wa ? 'dailyCap');

-- daily_cap/window_start/window_end are superseded by em.dailyCap/em.window
-- and wa.dailyCap/wa.window above. Left in place, unused, rather than
-- dropped — this table's migrations are additive-only.
