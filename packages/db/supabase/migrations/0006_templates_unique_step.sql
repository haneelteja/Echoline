-- At most one template per (project, channel, step). The prototype's own
-- sequence view (tplFor) and every worker query (`.maybeSingle()` on
-- project_id+channel+step) already assume this 1:1 relationship; nothing
-- enforced it at the database level. It's reachable today via the generic
-- POST /v1/projects/:id/templates (collections.ts exposes templates as a
-- plain CRUD collection with no per-field validation) — an operator posting
-- a second template for an existing step would silently break every future
-- send for that project the moment the worker's `.maybeSingle()` hits two rows.
alter table templates
  add constraint templates_project_channel_step_unique unique (project_id, channel, step);
