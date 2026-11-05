-- messages.contact_id and message_events.contact_id are "on delete cascade"
-- FKs from contacts but were never indexed, so deleting a contact forces
-- Postgres to sequentially scan both tables to find the rows to cascade
-- into. Harmless at today's row counts, but a real cost that scales with
-- both tables and compounds badly under the leads page's bulk-delete
-- ("delete invalid leads").
create index if not exists messages_contact_idx on messages(contact_id);
create index if not exists message_events_contact_idx on message_events(contact_id);
