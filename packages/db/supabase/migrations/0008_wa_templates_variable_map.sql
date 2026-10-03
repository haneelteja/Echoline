-- Phase 6: Meta template management. The variable map (our {{company}} etc.
-- placeholder keys, in the order they appear in the template body) is what
-- lets the worker rebuild the right positional {{1}}, {{2}}... parameters at
-- send time, matching what was actually submitted for approval.
alter table wa_templates add column variable_map jsonb not null default '[]';

-- One submission record per WhatsApp template — resubmitting updates the
-- existing row rather than accumulating duplicates.
alter table wa_templates add constraint wa_templates_template_id_unique unique (template_id);
