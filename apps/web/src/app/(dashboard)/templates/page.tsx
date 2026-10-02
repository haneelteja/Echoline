"use client";
import { useWorkspace } from "@/components/WorkspaceProvider";

export default function TemplatesPage() {
  const { templates } = useWorkspace();
  return (
    <>
      <div className="top">
        <div>
          <h1>Templates &amp; AI</h1>
          <p>Editing and AI generation ship in Phase 7. Read-only list for now.</p>
        </div>
      </div>
      <div className="tpl-list">
        {templates.map((t) => (
          <div key={t.id} className="tpl">
            <b>{t.name || "Untitled"}</b>
            <div className="s">
              {t.channel} · step {t.step + 1}
              {t.meta_status ? ` · ${t.meta_status}` : ""}
            </div>
          </div>
        ))}
        {!templates.length && <p className="muted small">No templates yet.</p>}
      </div>
    </>
  );
}
