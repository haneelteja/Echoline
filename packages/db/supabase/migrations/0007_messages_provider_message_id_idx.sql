-- Phase 4: webhooks look up messages by the provider's own message ID
-- (SendGrid/Resend/Meta/Twilio all reference their own ID, not ours).
create index messages_provider_message_id_idx on messages(provider_message_id) where provider_message_id is not null;
