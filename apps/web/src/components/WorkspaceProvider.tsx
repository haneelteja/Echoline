"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { apiFetch } from "@/lib/apiClient";
import type {
  BrandKbRow, ChannelSettingsRow, ContactRow, KbItemRow, LeadSourceRow,
  ProjectRow, SequenceSettingsRow, StatusLogEntry, TemplateRow,
} from "@/lib/types";

interface WorkspaceState {
  loadingProjects: boolean;
  loadingProject: boolean;
  projectsError: string | null;
  projectDataError: string | null;
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
  statusLog: StatusLogEntry[];
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
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [pid, setPidState] = useState<string | null>(null);

  const [loadingProject, setLoadingProject] = useState(false);
  const [projectDataError, setProjectDataError] = useState<string | null>(null);
  const [seq, setSeq] = useState<SequenceSettingsRow | null>(null);
  const [channels, setChannels] = useState<ChannelSettingsRow | null>(null);
  const [brand, setBrand] = useState<BrandKbRow | null>(null);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [kb, setKb] = useState<KbItemRow[]>([]);
  const [sources, setSources] = useState<LeadSourceRow[]>([]);
  const [statusLog, setStatusLog] = useState<StatusLogEntry[]>([]);

  const refreshProjects = useCallback(async () => {
    setLoadingProjects(true);
    setProjectsError(null);
    try {
      const data = await apiFetch<ProjectRow[]>("/v1/projects");
      setProjects(data);
      setPidState((cur) => (cur && data.find((p) => p.id === cur) ? cur : (data[0]?.id ?? null)));
    } catch (e) {
      console.error("Failed to load projects", e);
      setProjectsError(e instanceof Error ? e.message : "Couldn't load your projects.");
    } finally {
      setLoadingProjects(false);
    }
  }, []);

  const refreshProjectData = useCallback(async () => {
    if (!pid) return;
    setLoadingProject(true);
    setProjectDataError(null);
    // allSettled, not all — one failing endpoint (e.g. a transient 502 on a
    // cold-started Render service) must not leave every other slice stuck at
    // its stale/empty value with no visible explanation. Apply whichever
    // calls succeeded and surface which ones didn't.
    const results = await Promise.allSettled([
      apiFetch<SequenceSettingsRow>(`/v1/projects/${pid}/sequence`),
      apiFetch<ChannelSettingsRow>(`/v1/projects/${pid}/channels`),
      apiFetch<BrandKbRow>(`/v1/projects/${pid}/brand`),
      apiFetch<ContactRow[]>(`/v1/projects/${pid}/contacts`),
      apiFetch<TemplateRow[]>(`/v1/projects/${pid}/templates`),
      apiFetch<KbItemRow[]>(`/v1/projects/${pid}/kb`),
      apiFetch<LeadSourceRow[]>(`/v1/projects/${pid}/sources`),
      apiFetch<StatusLogEntry[]>(`/v1/projects/${pid}/status-log`),
    ]);
    const [seqR, chanR, brandR, contactsR, templatesR, kbR, sourcesR, statusLogR] = results;
    if (seqR.status === "fulfilled") setSeq(seqR.value);
    if (chanR.status === "fulfilled") setChannels(chanR.value);
    if (brandR.status === "fulfilled") setBrand(brandR.value);
    if (contactsR.status === "fulfilled") setContacts(contactsR.value);
    if (templatesR.status === "fulfilled") setTemplates(templatesR.value);
    if (kbR.status === "fulfilled") setKb(kbR.value);
    if (sourcesR.status === "fulfilled") setSources(sourcesR.value);
    if (statusLogR.status === "fulfilled") setStatusLog(statusLogR.value);

    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failed.length) {
      for (const f of failed) console.error("Failed to load part of the project workspace", f.reason);
      setProjectDataError(
        failed.length === results.length
          ? "Couldn't load this project's data."
          : `Some of this project's data didn't load (${failed.length}/${results.length} requests failed).`
      );
    }
    setLoadingProject(false);
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
      ["lead_status_log", async () => setStatusLog(await apiFetch(`/v1/projects/${pid}/status-log`))],
    ];
    const channel = supabase.channel(`project:${pid}`);
    for (const [table, reload] of tables) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter: `project_id=eq.${pid}` },
        () => reload().catch((e) => console.error(`Failed to refresh ${table} after a realtime change`, e))
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
    projectsError,
    projectDataError,
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
    statusLog,
    refreshProjects,
    refreshProjectData,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
