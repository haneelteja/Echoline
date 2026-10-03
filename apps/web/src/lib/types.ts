// Mirrors packages/db/src/database.types.ts — duplicated (not imported) so apps/web
// never pulls in the service-role-capable @echoline/db client into the browser bundle.

export type MembershipRole = "owner" | "admin" | "operator" | "viewer" | "client_viewer";

export type ContactChannelStatus =
  | "not_contacted" | "initial_sent" | "fu1_sent" | "fu2_sent" | "completed"
  | "replied" | "opted_out" | "invalid" | "bounced" | "failed";

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
}

export interface ChannelSettingsRow {
  project_id: string;
  email: Record<string, unknown>;
  wa: Record<string, unknown>;
}

export interface BrandKbRow {
  project_id: string;
  about: string | null;
  offer: string | null;
  pricing: string | null;
  tone: string | null;
  cta: string | null;
  skus: { code: string; name: string; size: string; price: string; moq: string }[];
}

export interface ContactRow {
  id: string;
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
}

export interface TemplateRow {
  id: string;
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
}

export interface KbItemRow {
  id: string;
  project_id: string;
  title: string | null;
  asset_id: string | null;
  tags: string[];
  text: string | null;
}

export interface LeadSourceRow {
  id: string;
  project_id: string;
  type: string;
  name: string;
  detail: string | null;
  mode: string | null;
  last_sync: string | null;
  rows_added: number;
  rows_skipped: number;
  rows_failed: number;
}

export type ConnectionStatus = "connected" | "needs_reconnect" | "disconnected";

export interface ConnectionRow {
  id: string;
  project_id: string;
  kind: "email" | "whatsapp" | "ai";
  provider: string;
  account_label: string | null;
  scopes: string[];
  status: ConnectionStatus;
  needs_reconnect_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface MessageEventRow {
  id: string;
  message_id: string | null;
  contact_id: string | null;
  channel: "em" | "wa" | null;
  event_type: string;
  payload: Record<string, unknown>;
  occurred_at: string;
  contacts: { name: string } | null;
}
