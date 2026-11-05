-- WorkspaceProvider.tsx subscribes to postgres_changes on these five tables
-- to auto-refresh the dashboard after any change (including "Mark replied",
-- which otherwise updates the row correctly but leaves the UI stale until a
-- manual reload, looking like it "doesn't work"). postgres_changes only
-- fires for tables added to the supabase_realtime publication — these were
-- never added, so the subscription silently never received anything.
-- Wrapped in existence checks since ALTER PUBLICATION ... ADD TABLE errors
-- if the table is already a member.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'contacts') then
    alter publication supabase_realtime add table contacts;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'templates') then
    alter publication supabase_realtime add table templates;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'kb_items') then
    alter publication supabase_realtime add table kb_items;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'lead_sources') then
    alter publication supabase_realtime add table lead_sources;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'lead_status_log') then
    alter publication supabase_realtime add table lead_status_log;
  end if;
end $$;
