-- Pause and archive as first-class, independent states on a lead source —
-- distinct from `mode` (sync cadence: 15 min/Hourly/Daily), so pausing
-- doesn't lose the configured cadence, and archiving doesn't delete rows or
-- history (rows_added/skipped/failed, config) the way a hard delete would.
alter table lead_sources add column paused boolean not null default false;
alter table lead_sources add column archived_at timestamptz;
