"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { apiFetch } from "@/lib/apiClient";
import type {
  BrandKbRow, ChannelSettingsRow, ContactRow, KbItemRow, LeadSourceRow,
  ProjectRow, SequenceSettingsRow, TemplateRow,
} from "@/lib/types";

interface WorkspaceState {
  loadingProjects: boolean;
  loadingProject: boolean;
  projects: ProjectRow[];
  pid: string | null;
  setPid: (id: string) => void;
  project: ProjectRow | null;
  seq: SequenceSettingsRow | null;
  channels: ChannelSettingsRow | null;
  brand: BrandKbRow | null;
  contacts: ContactRow[];
  templates: TemplateRow[];
  kb: KbItemRow[];
  sources: LeadSourceRow[];
  refreshProjects: () => Promise<void>;
  refreshProjectData: () => Promise<void>;
}

const Ctx = createContext<WorkspaceState | null>(null);

export function useWorkspace() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return ctx;
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [pid, setPidState] = useState<string | null>(null);

  const [loadingProject, setLoadingProject] = useState(false);
  const [seq, setSeq] = useState<SequenceSettingsRow | null>(null);
  const [channels, setChannels] = useState<ChannelSettingsRow | null>(null);
  const [brand, setBrand] = useState<BrandKbRow | null>(null);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [kb, setKb] = useState<KbItemRow[]>([]);
  const [sources, setSources] = useState<LeadSourceRow[]>([]);

  const refreshProjects = useCallback(async () => {
    setLoadingProjects(true);
    try {
      const data = await apiFetch<ProjectRow[]>("/v1/projects");
      setProjects(data);
      setPidState((cur) => cur && data.find((p) => p.id === cur) ? cur : data[0]?.id ?? null);
    } finally {
      setLoadingProjects(false);
    }
  }, []);

  const refreshProjectData = useCallback(async () => {
    if (!pid) return;
    setLoadingProject(true);
    try {
      const [seqData, chanData, brandData, contactsData, templatesData, kbData, sourcesData] = await Promise.all([
        apiFetch<SequenceSettingsRow>(`/v1/projects/${pid}/sequence`),
        apiFetch<ChannelSettingsRow>(`/v1/projects/${pid}/channels`),
        apiFetch<BrandKbRow>(`/v1/projects/${pid}/brand`),
        apiFetch<ContactRow[]>(`/v1/projects/${pid}/contacts`),
        apiFetch<TemplateRow[]>(`/v1/projects/${pid}/templates`),
        apiFetch<KbItemRow[]>(`/v1/projects/${pid}/kb`),
        apiFetch<LeadSourceRow[]>(`/v1/projects/${pid}/sources`),
      ]);
      setSeq(seqData);
      setChannels(chanData);
      setBrand(brandData);
      setContacts(contactsData);
      setTemplates(templatesData);
      setKb(kbData);
      setSources(sourcesData);
    } finally {
      setLoadingProject(false);
    }
  }, [pid]);

  useEffect(() => {
    refreshProjects();
  }, [refreshProjects]);

  useEffect(() => {
    refreshProjectData();
  }, [refreshProjectData]);

  // Realtime: any change to project-scoped tables triggers a refetch of that
  // slice. Simpler and more robust than hand-merging postgres_changes payloads,
  // and RLS still applies to the refetch so a client_viewer only ever sees what
  // they're scoped to.
  useEffect(() => {
    if (!pid) return;
    const tables: [string, () => Promise<void>][] = [
      ["contacts", async () => setContacts(await apiFetch(`/v1/projects/${pid}/contacts`))],
      ["templates", async () => setTemplates(await apiFetch(`/v1/projects/${pid}/templates`))],
      ["kb_items", async () => setKb(await apiFetch(`/v1/projects/${pid}/kb`))],
      ["lead_sources", async () => setSources(await apiFetch(`/v1/projects/${pid}/sources`))],
    ];
    const channel = supabase.channel(`project:${pid}`);
    for (const [table, reload] of tables) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter: `project_id=eq.${pid}` },
        () => reload()
      );
    }
    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [pid, supabase]);

  const project = projects.find((p) => p.id === pid) ?? null;

  const value: WorkspaceState = {
    loadingProjects,
    loadingProject,
    projects,
    pid,
    setPid: setPidState,
    project,
    seq,
    channels,
    brand,
    contacts,
    templates,
    kb,
    sources,
    refreshProjects,
    refreshProjectData,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
