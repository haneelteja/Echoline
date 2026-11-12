-- Saved, reusable email templates ("library") that aren't bound to any
-- sequence step — a starting point to copy into a step's own template.
-- Library rows don't participate in the per-step uniqueness check below
-- (they all use step 0 by convention, but that value is otherwise
-- meaningless for them).
alter table templates add column is_library boolean not null default false;

alter table templates drop constraint templates_project_channel_step_unique;
create unique index templates_project_channel_step_unique
  on templates (project_id, channel, step) where not is_library;
