"use client";
import { useState } from "react";
import { emailHTML, fill } from "@echoline/core";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { apiFetch, ApiError } from "@/lib/apiClient";
import type { TemplateRow } from "@/lib/types";

type GenChannel = "email" | "whatsapp";

export default function TemplatesPage() {
  const { pid, project, templates, refreshProjectData } = useWorkspace();
  const [editing, setEditing] = useState<TemplateRow | null>(null);
  const [draft, setDraft] = useState<{ name: string; subject: string; body: string; categoryLines: Record<string, string>; metaName: string; metaCategory: "MARKETING" | "UTILITY" | "AUTHENTICATION" } | null>(
    null
  );
  const [generating, setGenerating] = useState<GenChannel | null>(null);
  const [genGoal, setGenGoal] = useState("");
  const [genSteps, setGenSteps] = useState(3);
  const [genExtra, setGenExtra] = useState("");
  const [rewriteInstruction, setRewriteInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openEditor(t: TemplateRow) {
    setEditing(t);
    setDraft({
      name: t.name ?? "",
      subject: t.subject ?? "",
      body: t.body ?? "",
      categoryLines: t.category_lines ?? {},
      metaName: t.meta_name ?? "",
      metaCategory: "MARKETING",
    });
    setError(null);
  }

  async function save() {
    if (!pid || !editing || !draft) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/v1/projects/${pid}/templates/${editing.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: draft.name, subject: draft.subject, body: draft.body, category_lines: draft.categoryLines }),
      });
      setEditing(null);
      await refreshProjectData();
    } catch (e) {
      setError(e instanceof ApiError && e.status === 403 ? "You have view-only access and can't edit templates." : "Couldn't save");
    } finally {
      setBusy(false);
    }
  }

  async function generate() {
    if (!pid || !generating || !genGoal.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/v1/projects/${pid}/templates/ai-generate`, {
        method: "POST",
        body: JSON.stringify({ channel: generating, goal: genGoal, steps: genSteps, extra: genExtra || undefined }),
      });
      setGenerating(null);
      setGenGoal("");
      setGenExtra("");
      await refreshProjectData();
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.status === 403
            ? "AI features need admin access on this project."
            : e.body && typeof e.body === "object" && "error" in e.body && (e.body as { error?: string }).error === "no_connection"
              ? "Connect an AI provider under Email & WhatsApp → AI first."
              : e.message
          : "Generation failed"
      );
    } finally {
      setBusy(false);
    }
  }

  async function rewrite() {
    if (!pid || !editing || !rewriteInstruction.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await apiFetch<TemplateRow>(`/v1/projects/${pid}/templates/${editing.id}/ai-rewrite`, {
        method: "POST",
        body: JSON.stringify({ instruction: rewriteInstruction }),
      });
      setDraft((d) => (d ? { ...d, subject: updated.subject ?? d.subject, body: updated.body ?? d.body, categoryLines: updated.category_lines ?? d.categoryLines } : d));
      setRewriteInstruction("");
      await refreshProjectData();
    } catch (e) {
      setError(
        e instanceof ApiError && e.body && typeof e.body === "object" && "error" in e.body && (e.body as { error?: string }).error === "no_connection"
          ? "Connect an AI provider under Email & WhatsApp → AI first."
          : "Rewrite failed"
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitToMeta() {
    if (!pid || !editing || !draft) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/v1/projects/${pid}/templates/${editing.id}/submit-whatsapp`, {
        method: "POST",
        body: JSON.stringify({ metaName: draft.metaName, category: draft.metaCategory }),
      });
      await refreshProjectData();
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.status === 403
            ? "Submitting to Meta needs admin access."
            : e.body && typeof e.body === "object" && "error" in e.body && (e.body as { error?: string }).error === "no_connection"
              ? "Connect a Meta WhatsApp provider first."
              : e.message
          : "Submission failed"
      );
    } finally {
      setBusy(false);
    }
  }

  const emailTemplates = templates.filter((t) => t.channel === "email").sort((a, b) => a.step - b.step);
  const waTemplates = templates.filter((t) => t.channel === "whatsapp").sort((a, b) => a.step - b.step);

  const previewHtml =
    editing && draft && editing.channel === "email" && project
      ? emailHTML(
          { body: draft.body },
          {
            project: { name: project.name, brand: project.brand, senderName: project.sender_name, website: project.website, waNumber: project.wa_number, accent: project.accent },
            contact: { name: "Acme Corp", area: "Gachibowli", category: "Restaurant" },
            template: { categoryLines: draft.categoryLines },
          },
          { galleryUrls: [] }
        )
      : null;

  const waPreviewText =
    editing && draft && editing.channel === "whatsapp" && project
      ? fill(draft.body, {
          project: { name: project.name, brand: project.brand, senderName: project.sender_name, website: project.website, waNumber: project.wa_number, accent: project.accent },
          contact: { name: "Acme Corp", area: "Gachibowli", category: "Restaurant" },
          template: { categoryLines: draft.categoryLines },
        })
      : null;

  return (
    <>
      <div className="top">
        <div>
          <h1>Templates &amp; AI</h1>
          <p>Edit by hand, or generate a sequence with AI (needs a connected AI provider under Email &amp; WhatsApp).</p>
        </div>
        <div className="row">
          <button className="btn" onClick={() => setGenerating("email")}>
            Generate email sequence
          </button>
          <button className="btn" onClick={() => setGenerating("whatsapp")}>
            Generate WhatsApp sequence
          </button>
        </div>
      </div>

      {error && (
        <p className="small" style={{ color: "var(--bad)", marginBottom: 12 }}>
          {error}
        </p>
      )}

      <div className="grid g2">
        <section className="panel">
          <h2 style={{ marginBottom: 12 }}>Email</h2>
          <div className="tpl-list">
            {emailTemplates.map((t) => (
              <div key={t.id} className="tpl" role="button" tabIndex={0} onClick={() => openEditor(t)} style={{ cursor: "pointer" }}>
                <b>{t.name || "Untitled"}</b>
                <div className="s">
                  step {t.step + 1}
                  {t.ai ? " · AI" : ""}
                </div>
              </div>
            ))}
            {!emailTemplates.length && <p className="muted small">No email templates yet.</p>}
          </div>
        </section>
        <section className="panel">
          <h2 style={{ marginBottom: 12 }}>WhatsApp</h2>
          <div className="tpl-list">
            {waTemplates.map((t) => (
              <div key={t.id} className="tpl" role="button" tabIndex={0} onClick={() => openEditor(t)} style={{ cursor: "pointer" }}>
                <b>{t.name || "Untitled"}</b>
                <div className="s">
                  step {t.step + 1}
                  {t.meta_status ? ` · ${t.meta_status}` : ""}
                  {t.ai ? " · AI" : ""}
                </div>
              </div>
            ))}
            {!waTemplates.length && <p className="muted small">No WhatsApp templates yet.</p>}
          </div>
        </section>
      </div>

      {generating && (
        <div className="scrim open" onClick={() => setGenerating(null)}>
          <div className="drawer open" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <header>
              <h2>Generate {generating === "email" ? "email" : "WhatsApp"} sequence</h2>
              <button className="btn small" onClick={() => setGenerating(null)} aria-label="Close">
                ✕
              </button>
            </header>
            <div className="body">
              <div className="field">
                <label htmlFor="gg">Goal of this campaign</label>
                <textarea id="gg" value={genGoal} onChange={(e) => setGenGoal(e.target.value)} placeholder="Book a call or get a reply asking for a free sample" />
              </div>
              <div className="field">
                <label htmlFor="gs">Steps</label>
                <select id="gs" value={genSteps} onChange={(e) => setGenSteps(Number(e.target.value))}>
                  <option value={3}>Initial + 2 follow-ups</option>
                  <option value={2}>Initial + 1 follow-up</option>
                  <option value={1}>Initial only</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="ge">Anything else (optional)</label>
                <input id="ge" value={genExtra} onChange={(e) => setGenExtra(e.target.value)} placeholder="e.g. mention Diwali gifting, keep under 90 words" />
              </div>
              <p className="hint">Uses this project&apos;s knowledge base and lead categories.</p>
            </div>
            <div className="foot">
              <button className="btn" onClick={() => setGenerating(null)}>
                Cancel
              </button>
              <button className="btn primary" onClick={generate} disabled={busy || !genGoal.trim()}>
                {busy ? "Generating…" : "Generate"}
              </button>
            </div>
          </div>
        </div>
      )}

      {editing && draft && (
        <div className="scrim open" onClick={() => setEditing(null)}>
          <div className="drawer open" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" style={{ maxWidth: 720 }}>
            <header>
              <h2>Edit {editing.channel === "email" ? "email" : "WhatsApp"} template</h2>
              <button className="btn small" onClick={() => setEditing(null)} aria-label="Close">
                ✕
              </button>
            </header>
            <div className="body">
              <div className="field">
                <label htmlFor="tn">Name</label>
                <input id="tn" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </div>
              {editing.channel === "email" && (
                <div className="field">
                  <label htmlFor="ts">Subject</label>
                  <input id="ts" value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
                </div>
              )}
              <div className="field">
                <label htmlFor="tb">Body</label>
                <textarea id="tb" style={{ minHeight: 160 }} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="tcl">Default category line</label>
                <input
                  id="tcl"
                  value={draft.categoryLines.default ?? ""}
                  onChange={(e) => setDraft({ ...draft, categoryLines: { ...draft.categoryLines, default: e.target.value } })}
                  placeholder="used when a lead's category has no specific line"
                />
              </div>

              <div className="field">
                <label htmlFor="rw">Rewrite with AI</label>
                <div className="row">
                  <input id="rw" value={rewriteInstruction} onChange={(e) => setRewriteInstruction(e.target.value)} placeholder="Shorter, more direct, mention the 250 ml size…" style={{ flex: 1 }} />
                  <button className="btn" onClick={rewrite} disabled={busy || !rewriteInstruction.trim()}>
                    {busy ? "…" : "Rewrite"}
                  </button>
                </div>
              </div>

              {editing.channel === "whatsapp" && (
                <>
                  <div className="field">
                    <label htmlFor="mn">Meta template name</label>
                    <input id="mn" value={draft.metaName} onChange={(e) => setDraft({ ...draft, metaName: e.target.value })} placeholder="initial_outreach_v1" />
                  </div>
                  <div className="field">
                    <label htmlFor="mc">Meta category</label>
                    <select id="mc" value={draft.metaCategory} onChange={(e) => setDraft({ ...draft, metaCategory: e.target.value as typeof draft.metaCategory })}>
                      <option value="MARKETING">Marketing</option>
                      <option value="UTILITY">Utility</option>
                      <option value="AUTHENTICATION">Authentication</option>
                    </select>
                  </div>
                  <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                    <span className="small muted">Status: {editing.meta_status ?? "Draft"}</span>
                    <button className="btn" onClick={submitToMeta} disabled={busy || !draft.metaName.trim()}>
                      {busy ? "…" : "Submit to Meta"}
                    </button>
                  </div>
                </>
              )}

              <div className="field">
                <label>Preview</label>
                {editing.channel === "email" && previewHtml ? (
                  <iframe title="Email preview" srcDoc={previewHtml} style={{ width: "100%", height: 360, border: "1px solid var(--border, #e0e0e0)", borderRadius: 8 }} />
                ) : (
                  <div className="panel" style={{ background: "#dcf8c6", whiteSpace: "pre-wrap", fontSize: 14 }}>
                    {waPreviewText}
                  </div>
                )}
              </div>
            </div>
            <div className="foot">
              <button className="btn" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button className="btn primary" onClick={save} disabled={busy}>
                {busy ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
