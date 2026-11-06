-- Per-project test-send-mode flag, surfaced in Project settings. Defaults to
-- true (safe) same as the pre-existing TEST_SEND_MODE env var it works
-- alongside: isTestSendMode() in apps/api and apps/worker now treats the env
-- var as a deployment-wide safety valve (unset/not "false" => every project
-- stays in test mode, this column can't override that) and, once that's been
-- explicitly turned off, this column as the per-project gate. Write access is
-- restricted in the API layer to a single operator account, not by RLS here —
-- same model as every other project-settings field (can_write_project).
alter table projects add column test_send_mode boolean not null default true;
