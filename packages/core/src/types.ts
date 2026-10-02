import type { ChannelKey, ContactChannelStatus } from "./status";

export interface SequenceStep {
  delayDays: number;
}

export interface SequenceChannelConfig {
  enabled: boolean;
  steps: SequenceStep[];
}

export interface SequenceSettings {
  dailyCap: number;
  window: { start: string; end: string }; // "HH:MM", evaluated in project timezone
  stopOnReply: boolean;
  em: SequenceChannelConfig;
  wa: SequenceChannelConfig;
}

export interface Contact {
  id: string;
  projectId: string;
  name: string;
  contactPerson?: string | null;
  category?: string | null;
  area?: string | null;
  phone?: string | null;
  email?: string | null;
  source?: string | null;
  demo?: boolean;
  em_stage: number;
  em_status: ContactChannelStatus;
  em_last?: string | null; // ISO
  em_track?: string | null;
  wa_stage: number;
  wa_status: ContactChannelStatus;
  wa_last?: string | null; // ISO
  wa_track?: string | null;
}

export interface DueStep {
  contactId: string;
  channel: ChannelKey;
  step: number;
  at: string; // ISO — when this step becomes due
  valid: boolean; // whether the contact has a usable email/phone for this channel
}

export interface Template {
  id: string;
  projectId: string;
  channel: "email" | "whatsapp";
  step: number;
  name?: string | null;
  subject?: string | null;
  body: string;
  categoryLines: Record<string, string>;
  metaName?: string | null;
  metaStatus?: string | null;
}

export interface ProjectBrand {
  name: string;
  brand?: string | null;
  senderName?: string | null;
  website?: string | null;
  waNumber?: string | null;
  accent?: string | null;
}
