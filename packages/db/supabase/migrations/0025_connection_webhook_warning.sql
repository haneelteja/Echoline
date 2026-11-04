-- Surfaces a non-blocking warning on a provider_connections row, distinct
-- from status/needs_reconnect_reason. Needed because 360Messenger's inbound
-- webhook registration can fail (e.g. "FEATURE_LOCKED: Invalid package
-- level" when the account's plan doesn't include webhooks) while the
-- connection itself is still perfectly healthy for sending — marking it
-- needs_reconnect would be wrong (outbound sends would stop working too)
-- and the failure was previously only logged server-side, invisible in the
-- UI. Generic column name/comment since this isn't 360Messenger-specific in
-- principle, even though it's the only provider that sets it today.
alter table provider_connections add column webhook_warning text;
