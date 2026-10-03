"use client";
import { useEffect, useState } from "react";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { apiFetch, ApiError } from "@/lib/apiClient";

export default function ProjectSettingsPage() {
  const { pid, project, refreshProjects } = useWorkspace();
  const [name, setName] = useState("");
  const [brand, setBrand] = useState("");
  const [senderName, setSenderName] = useState("");
  const [website, setWebsite] = useState("");
  const [waNumber, setWaNumber] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // project loads async (null on first render if this page loads directly,
  // e.g. a refresh) — useState's initial value only applies on the very
  // first render, so seeding it from project?.x there would silently leave
  // these fields blank forever once project actually arrives. This re-syncs
  // whenever project changes instead.
  useEffect(() => {
    if (!project) return;
    setName(project.name ?? "");
    setBrand(project.brand ?? "");
    setSenderName(project.sender_name ?? "");
    setWebsite(project.website ?? "");
    setWaNumber(project.wa_number ?? "");
  }, [project]);

  if (!project) return <div className="empty">Loading…</div>;

  async function save() {
    if (!pid) return;
    setError(null);
    setSaved(false);
    try {
      await apiFetch(`/v1/projects/${pid}`, {
        method: "PATCH",
        body: JSON.stringify({ name, brand, senderName, website, waNumber }),
      });
      setSaved(true);
      await refreshProjects();
    } catch (e) {
      setError(e instanceof ApiError && e.status === 403 ? "You have view-only access and can't edit project settings." : "Save failed.");
    }
  }

  return (
    <>
      <div className="top">
        <div>
          <h1>Project settings</h1>
          <p>Identity used in templates and email branding.</p>
        </div>
      </div>
      <section className="panel" style={{ maxWidth: 680 }}>
        <div className="field">
          <label htmlFor="name">Project name</label>
          <input id="name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="brand">Brand name in messages</label>
          <input id="brand" value={brand ?? ""} onChange={(e) => setBrand(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="sender">Sender name</label>
          <input id="sender" value={senderName ?? ""} onChange={(e) => setSenderName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="website">Website</label>
          <input id="website" value={website ?? ""} onChange={(e) => setWebsite(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="wa">WhatsApp number for click-to-chat</label>
          <input id="wa" value={waNumber ?? ""} onChange={(e) => setWaNumber(e.target.value)} />
        </div>
        <button className="btn primary" onClick={save}>
          Save project
        </button>
        {saved && <span className="small muted" style={{ marginLeft: 10 }}>Saved.</span>}
        {error && (
          <p className="small" style={{ color: "var(--bad)", marginTop: 10 }}>
            {error}
          </p>
        )}
      </section>
    </>
  );
}
