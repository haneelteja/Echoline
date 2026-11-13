-- Lets a webhook/form lead source carry a stable external lead ID (e.g. a
-- spreadsheet's own Lead ID column) so a re-synced row with a *changed*
-- email/phone updates the existing contact instead of silently inserting a
-- duplicate — intake.ts's existing dedup only matches on email/phone, which
-- can't recognize "same lead, new contact info." Nullable and non-unique
-- across projects (two different projects' own numbering schemes can
-- collide), scoped unique only within a project, and only when actually set.
alter table contacts add column external_id text;

create unique index contacts_external_id_idx
  on contacts (project_id, external_id)
  where external_id is not null;
