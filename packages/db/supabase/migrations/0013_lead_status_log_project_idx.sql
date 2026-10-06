-- lead_status_log only indexed (contact_id, created_at desc). The Leads
-- page's project-wide "latest status per contact" listing
-- (GET /projects/:id/status-log) filters by project_id and orders by
-- created_at desc — without this index that query sequential-scans the
-- whole table, getting slower every time a status update is logged.
create index lead_status_log_project_idx on lead_status_log (project_id, created_at desc);
