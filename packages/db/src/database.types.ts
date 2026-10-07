// Hand-written row types mirroring supabase/migrations/0001_init.sql.
// TODO(Phase 1 follow-up): replace with `supabase gen types typescript` output once
// a Docker-enabled environment is available (gen types requires local postgres-meta).

export type MembershipRole = "owner" | "admin" | "operator" | "viewer" | "client_viewer";

export type ContactChannelStatus =
  | "not_contacted"
  | "initial_sent"
  | "fu1_sent"
  | "fu2_sent"
  | "completed"
  | "replied"
  | "opted_out"
  | "invalid"
  | "bounced"
  | "failed";

export interface OrganizationRow {
  id: string;
  name: string;
  created_at: string;
}

export interface MembershipRow {
  id: string;
  org_id: string;
  user_id: string;
  role: MembershipRole;
  created_at: string;
}

export interface ProjectRow {
  id: string;
  org_id: string;
  name: string;
  brand: string | null;
  sender_name: string | null;
  website: string | null;
  wa_number: string | null;
  accent: string | null;
  timezone: string;
  created_at: string;
}

export interface SequenceSettingsRow {
  project_id: string;
  daily_cap: number;
  window_start: string;
  window_end: string;
  stop_on_reply: boolean;
  em: { enabled: boolean; steps: { delayDays: number }[] };
  wa: { enabled: boolean; steps: { delayDays: number }[] };
  updated_at: string;
}

export interface ChannelSettingsRow {
  project_id: string;
  email: Record<string, unknown>;
  wa: Record<string, unknown>;
  updated_at: string;
}

export interface BrandKbRow {
  project_id: string;
  about: string | null;
  offer: string | null;
  pricing: string | null;
  tone: string | null;
  cta: string | null;
  skus: { code: string; name: string; size: string; price: string; moq: string }[];
  updated_at: string;
}

export interface KbItemRow {
  id: string;
  org_id: string;
  project_id: string;
  title: string | null;
  asset_id: string | null;
  tags: string[];
  text: string | null;
  created_at: string;
}

export interface TemplateRow {
  id: string;
  org_id: string;
  project_id: string;
  channel: "email" | "whatsapp";
  step: number;
  name: string | null;
  subject: string | null;
  body: string | null;
  category_lines: Record<string, string>;
  meta_name: string | null;
  meta_status: string | null;
  ai: boolean;
  header_asset_id: string | null;
  gallery_asset_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface KbFolderRow {
  id: string;
  org_id: string;
  project_id: string;
  parent_id: string | null;
  name: string;
  created_at: string;
}

export interface KbAssetRow {
  id: string;
  org_id: string;
  project_id: string;
  folder_id: string | null;
  kind: "image" | "document";
  name: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  url: string;
  created_at: string;
}

export interface ContactRow {
  id: string;
  org_id: string;
  project_id: string;
  name: string;
  contact_person: string | null;
  category: string | null;
  area: string | null;
  phone: string | null;
  email: string | null;
  source: string | null;
  demo: boolean;
  em_stage: number;
  em_status: ContactChannelStatus;
  em_last: string | null;
  em_track: string | null;
  wa_stage: number;
  wa_status: ContactChannelStatus;
  wa_last: string | null;
  wa_track: string | null;
  created_at: string;
  updated_at: string;
}

export interface LeadSourceRow {
  id: string;
  org_id: string;
  project_id: string;
  type: string;
  name: string;
  detail: string | null;
  config: Record<string, unknown>;
  mode: string | null;
  last_sync: string | null;
  rows_added: number;
  rows_skipped: number;
  rows_failed: number;
  created_at: string;
}

export interface MessageRow {
  id: string;
  org_id: string;
  project_id: string;
  contact_id: string;
  channel: "em" | "wa";
  step: number;
  provider_connection_id: string | null;
  provider_message_id: string | null;
  status: "queued" | "sent" | "delivered" | "opened" | "clicked" | "read" | "bounced" | "failed";
  queued_at: string;
  sent_at: string | null;
  updated_at: string;
}

export interface MessageEventRow {
  id: string;
  org_id: string;
  project_id: string;
  message_id: string | null;
  contact_id: string | null;
  channel: "em" | "wa" | null;
  event_type: string;
  payload: Record<string, unknown>;
  occurred_at: string;
  created_at: string;
}
