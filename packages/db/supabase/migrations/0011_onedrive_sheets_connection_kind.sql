-- OneDrive Excel and Google Sheets lead sync reuse provider_connections/the
-- credential vault for their OAuth tokens (same pattern as every other
-- connection kind), rather than inventing separate storage. One connected
-- account per project per kind; a project can still have multiple lead
-- *sources* (different workbooks/sheets) pointing at that one connection.
alter type connection_kind add value 'onedrive';
alter type connection_kind add value 'google_sheets';
