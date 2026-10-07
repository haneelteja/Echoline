"use client";
import { useEffect, useState } from "react";
import { Send } from "lucide-react";
import { emailHTML, fill } from "@echoline/core";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { apiFetch, ApiError } from "@/lib/apiClient";
import type { SequenceSettingsRow, TemplateRow } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type ChannelKey = "em" | "wa";
type GenChannel = "email" | "whatsapp";

const CH_LABEL: Record<ChannelKey, string> = { em: "Email", wa: "WhatsApp" };
const CH_TEMPLATE: Record<ChannelKey, GenChannel> = { em: "email", wa: "whatsapp" };
const STEP_LABEL = ["Initial", "Follow-up 1", "Follow-up 2", "Follow-up 3"];

interface TemplateDraft {
  name: string;
  subject: string;
  body: string;
  categoryLines: Record<string, string>;
  metaName: string;
  metaCategory: "MARKETING" | "UTILITY" | "AUTHENTICATION";
}

export default function SequencePage() {
  const { pid, project, seq, templates, refreshProjectData } = useWorkspace();

  const [draft, setDraft] = useState<SequenceSettingsRow | null>(seq);
  const [seqSaved, setSeqSaved] = useState(false);
  const [seqError, setSeqError] = useState<string | null>(null);

  const [editing, setEditing] = useState<TemplateRow | null>(null);
  const [draftTpl, setDraftTpl] = useState<TemplateDraft | null>(null);
  const [generating, setGenerating] = useState<GenChannel | null>(null);
  const [genGoal, setGenGoal] = useState("");
  const [genSteps, setGenSteps] = useState(3);
  const [genExtra, setGenExtra] = useState("");
  const [rewriteInstruction, setRewriteInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [tplError, setTplError] = useState<string | null>(null);

  const [testEmailTo, setTestEmailTo] = useState("");
  const [testEmailStatus, setTestEmailStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [testEmailError, setTestEmailError] = useState<string | null>(null);

  // Syncs the local draft once seq finishes loading (it's null on first
  // render — WorkspaceProvider fetches it async). Calling setState directly
  // during render worked but is a React anti-pattern and wouldn't re-sync
  // if seq changed again later; this effect does, correctly.
  useEffect(() => {
    if (seq) setDraft(seq);
  }, [seq]);

  if (!draft) return <div className="empty">Loading…</div>;

  async function saveSequence() {
    if (!pid || !draft) return;
    setSeqError(null);
    setSeqSaved(false);
    try {
      await apiFetch(`/v1/projects/${pid}/sequence`, {
        method: "PUT",
        body: JSON.stringify({
          dailyCap: draft.daily_cap,
          window: { start: draft.window_start.slice(0, 5), end: draft.window_end.slice(0, 5) },
          stopOnReply: draft.stop_on_reply,
          em: draft.em,
          wa: draft.wa,
        }),
      });
      setSeqSaved(true);
      await refreshProjectData();
    } catch (e) {
      setSeqError(e instanceof ApiError && e.status === 403 ? "You have view-only access and can't change the sequence." : "Save failed.");
    }
  }

  function templateFor(ch: ChannelKey, step: number): TemplateRow | null {
    return templates.find((t) => t.channel === CH_TEMPLATE[ch] && t.step === step) ?? null;
  }

  function openEditor(t: TemplateRow) {
    setEditing(t);
    setDraftTpl({
      name: t.name ?? "",
      subject: t.subject ?? "",
      body: t.body ?? "",
      categoryLines: t.category_lines ?? {},
      metaName: t.meta_name ?? "",
      metaCategory: "MARKETING",
    });
    setTplError(null);
    setTestEmailTo("");
    setTestEmailStatus("idle");
    setTestEmailError(null);
  }

  async function createTemplate(ch: ChannelKey, step: number) {
    if (!pid) return;
    setBusy(true);
    setTplError(null);
    try {
      const created = await apiFetch<TemplateRow>(`/v1/projects/${pid}/templates`, {
        method: "POST",
        body: JSON.stringify({
          channel: CH_TEMPLATE[ch],
          step,
          name: STEP_LABEL[step] ?? `Step ${step + 1}`,
          subject: "",
          body: "",
          category_lines: {},
          meta_status: ch === "wa" ? "Draft" : null,
        }),
      });
      await refreshProjectData();
      openEditor(created);
    } catch (e) {
      setTplError(e instanceof ApiError && e.status === 403 ? "You have view-only access and can't create templates." : "Couldn't create template.");
    } finally {
      setBusy(false);
    }
  }

  async function saveTemplate() {
    if (!pid || !editing || !draftTpl) return;
    setBusy(true);
    setTplError(null);
    try {
      await apiFetch(`/v1/projects/${pid}/templates/${editing.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: draftTpl.name, subject: draftTpl.subject, body: draftTpl.body, category_lines: draftTpl.categoryLines }),
      });
      setEditing(null);
      await refreshProjectData();
    } catch (e) {
      setTplError(e instanceof ApiError && e.status === 403 ? "You have view-only access and can't edit templates." : "Couldn't save");
    } finally {
      setBusy(false);
    }
  }

  async function generate() {
    if (!pid || !generating || !genGoal.trim()) return;
    setBusy(true);
    setTplError(null);
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
      setTplError(
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
    setTplError(null);
    try {
      const updated = await apiFetch<TemplateRow>(`/v1/projects/${pid}/templates/${editing.id}/ai-rewrite`, {
        method: "POST",
        body: JSON.stringify({ instruction: rewriteInstruction }),
      });
      setDraftTpl((d) => (d ? { ...d, subject: updated.subject ?? d.subject, body: updated.body ?? d.body, categoryLines: updated.category_lines ?? d.categoryLines } : d));
      setRewriteInstruction("");
      await refreshProjectData();
    } catch (e) {
      setTplError(
        e instanceof ApiError && e.body && typeof e.body === "object" && "error" in e.body && (e.body as { error?: string }).error === "no_connection"
          ? "Connect an AI provider under Email & WhatsApp → AI first."
          : "Rewrite failed"
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitToMeta() {
    if (!pid || !editing || !draftTpl) return;
    setBusy(true);
    setTplError(null);
    try {
      await apiFetch(`/v1/projects/${pid}/templates/${editing.id}/submit-whatsapp`, {
        method: "POST",
        body: JSON.stringify({ metaName: draftTpl.metaName, category: draftTpl.metaCategory }),
      });
      await refreshProjectData();
    } catch (e) {
      setTplError(
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

  async function sendTestEmail() {
    if (!pid || !editing || !draftTpl || editing.channel !== "email" || !testEmailTo.trim()) return;
    setTestEmailStatus("sending");
    setTestEmailError(null);
    try {
      await apiFetch(`/v1/projects/${pid}/templates/send-test-email`, {
        method: "POST",
        body: JSON.stringify({ to: testEmailTo.trim(), subject: draftTpl.subject, body: draftTpl.body, categoryLines: draftTpl.categoryLines }),
      });
      setTestEmailStatus("sent");
    } catch (e) {
      setTestEmailStatus("error");
      setTestEmailError(
        e instanceof ApiError
          ? e.body && typeof e.body === "object" && "error" in e.body && (e.body as { error?: string }).error === "no_connection"
            ? "Connect an email provider under Email & WhatsApp first."
            : e.message
          : "Couldn't send test email."
      );
    }
  }

  const previewHtml =
    editing && draftTpl && editing.channel === "email" && project
      ? emailHTML(
          { body: draftTpl.body },
          {
            project: { name: project.name, brand: project.brand, senderName: project.sender_name, website: project.website, waNumber: project.wa_number, accent: project.accent },
            contact: { name: "Acme Corp", area: "Gachibowli", category: "Restaurant" },
            template: { categoryLines: draftTpl.categoryLines },
          },
          { galleryUrls: [] }
        )
      : null;

  const waPreviewText =
    editing && draftTpl && editing.channel === "whatsapp" && project
      ? fill(draftTpl.body, {
          project: { name: project.name, brand: project.brand, senderName: project.sender_name, website: project.website, waNumber: project.wa_number, accent: project.accent },
          contact: { name: "Acme Corp", area: "Gachibowli", category: "Restaurant" },
          template: { categoryLines: draftTpl.categoryLines },
        })
      : null;

  function column(ch: ChannelKey) {
    const steps = draft![ch].steps;
    return (
      <section className="panel" key={ch}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 14 }}>
          <h2>{CH_LABEL[ch]}</h2>
          <div className="row small" style={{ gap: 10 }}>
            <label className="row small">
              <input
                type="checkbox"
                checked={draft![ch].enabled}
                onChange={(e) => setDraft({ ...draft!, [ch]: { ...draft![ch], enabled: e.target.checked } })}
              />
              Active
            </label>
            <button className="btn small" onClick={() => setGenerating(CH_TEMPLATE[ch])}>
              Generate with AI
            </button>
          </div>
        </div>

        {steps.map((s, i) => {
          const tpl = templateFor(ch, i);
          return (
            <div
              key={i}
              className="row"
              style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 10, paddingBottom: 10, borderBottom: "1px solid var(--border, #e8e8e8)" }}
            >
              <div style={{ minWidth: 140 }}>
                <b className="small">{STEP_LABEL[i] ?? `Step ${i + 1}`}</b>
                <div className="small muted">
                  {i === 0 ? (
                    "sent immediately"
                  ) : (
                    <>
                      wait
                      <input
                        className="inp"
                        type="number"
                        min={0}
                        style={{ width: 56, margin: "0 6px" }}
                        value={s.delayDays}
                        onChange={(e) => {
                          const next = [...steps];
                          next[i] = { delayDays: Math.max(0, Number(e.target.value) || 0) };
                          setDraft({ ...draft!, [ch]: { ...draft![ch], steps: next } });
                        }}
                      />
                      days
                    </>
                  )}
                </div>
              </div>
              <div style={{ flex: 1, textAlign: "right" }}>
                {tpl ? (
                  <>
                    <div className="small" style={{ marginBottom: 4 }}>
                      <b>{tpl.name || "Untitled"}</b>
                      {tpl.ai ? " · AI" : ""}
                      {ch === "wa" && tpl.meta_status ? ` · ${tpl.meta_status}` : ""}
                    </div>
                    <button className="btn small" onClick={() => openEditor(tpl)}>
                      Edit template
                    </button>
                  </>
                ) : (
                  <button className="btn small" disabled={busy} onClick={() => createTemplate(ch, i)}>
                    Choose / create template
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </section>
    );
  }

  return (
    <>
      <div className="top">
        <div>
          <h1>Sequence &amp; Templates</h1>
          <p>When each message goes out, and what it says. Email and WhatsApp run independently.</p>
        </div>
      </div>

      {tplError && (
        <p className="small" style={{ color: "var(--bad)", marginBottom: 12 }}>
          {tplError}
        </p>
      )}

      <div className="grid g2" style={{ marginBottom: 16 }}>
        {column("em")}
        {column("wa")}
      </div>

      <section className="panel">
        <h2>Sending rules</h2>
        <div className="grid g3" style={{ marginTop: 12 }}>
          <div className="field">
            <label htmlFor="cap">Daily cap per channel</label>
            <input
              id="cap"
              type="number"
              min={1}
              value={draft.daily_cap}
              onChange={(e) => setDraft({ ...draft, daily_cap: Math.max(1, Number(e.target.value) || 1) })}
            />
          </div>
          <div className="field">
            <label htmlFor="ws">Send window start</label>
            <input id="ws" type="time" value={draft.window_start.slice(0, 5)} onChange={(e) => setDraft({ ...draft, window_start: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="we">Send window end</label>
            <input id="we" type="time" value={draft.window_end.slice(0, 5)} onChange={(e) => setDraft({ ...draft, window_end: e.target.value })} />
          </div>
          <div className="field">
            <label className="row">
              <input type="checkbox" checked={draft.stop_on_reply} onChange={(e) => setDraft({ ...draft, stop_on_reply: e.target.checked })} />
              Stop both channels when a lead replies or opts out
            </label>
          </div>
        </div>
        <button className="btn primary" onClick={saveSequence}>
          Save sequence
        </button>
        {seqSaved && <span className="small muted" style={{ marginLeft: 10 }}>Saved.</span>}
        {seqError && (
          <p className="small" style={{ color: "var(--bad)", marginTop: 10 }}>
            {seqError}
          </p>
        )}
      </section>

      <Dialog open={!!generating} onOpenChange={(open) => !open && setGenerating(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Generate {generating === "email" ? "email" : "WhatsApp"} sequence</DialogTitle>
          </DialogHeader>
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
          <DialogFooter>
            <Button variant="outline" onClick={() => setGenerating(null)}>
              Cancel
            </Button>
            <Button onClick={generate} disabled={busy || !genGoal.trim()}>
              {busy ? "Generating…" : "Generate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!(editing && draftTpl)} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-4xl">
          {editing && draftTpl && (
            <>
              <DialogHeader>
                <DialogTitle>Edit {editing.channel === "email" ? "email" : "WhatsApp"} template</DialogTitle>
              </DialogHeader>
              <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
                <div className="flex flex-col gap-3">
                  <div className="field">
                    <label htmlFor="tn">Name</label>
                    <input id="tn" value={draftTpl.name} onChange={(e) => setDraftTpl({ ...draftTpl, name: e.target.value })} />
                  </div>
                  {editing.channel === "email" && (
                    <div className="field">
                      <label htmlFor="ts">Subject</label>
                      <input id="ts" value={draftTpl.subject} onChange={(e) => setDraftTpl({ ...draftTpl, subject: e.target.value })} />
                    </div>
                  )}
                  <div className="field">
                    <label htmlFor="tb">Body</label>
                    <textarea id="tb" style={{ minHeight: 160 }} value={draftTpl.body} onChange={(e) => setDraftTpl({ ...draftTpl, body: e.target.value })} />
                  </div>
                  <div className="field">
                    <label htmlFor="tcl">Default category line</label>
                    <input
                      id="tcl"
                      value={draftTpl.categoryLines.default ?? ""}
                      onChange={(e) => setDraftTpl({ ...draftTpl, categoryLines: { ...draftTpl.categoryLines, default: e.target.value } })}
                      placeholder="used when a lead's category has no specific line"
                    />
                  </div>

                  <div className="field">
                    <label htmlFor="rw">Rewrite with AI</label>
                    <div className="row">
                      <input
                        id="rw"
                        value={rewriteInstruction}
                        onChange={(e) => setRewriteInstruction(e.target.value)}
                        placeholder="Shorter, more direct, mention the 250 ml size…"
                        style={{ flex: 1 }}
                      />
                      <Button variant="outline" onClick={rewrite} disabled={busy || !rewriteInstruction.trim()}>
                        {busy ? "…" : "Rewrite"}
                      </Button>
                    </div>
                  </div>

                  {editing.channel === "whatsapp" && (
                    <>
                      <div className="field">
                        <label htmlFor="mn">Meta template name</label>
                        <input id="mn" value={draftTpl.metaName} onChange={(e) => setDraftTpl({ ...draftTpl, metaName: e.target.value })} placeholder="initial_outreach_v1" />
                      </div>
                      <div className="field">
                        <label htmlFor="mc">Meta category</label>
                        <select id="mc" value={draftTpl.metaCategory} onChange={(e) => setDraftTpl({ ...draftTpl, metaCategory: e.target.value as TemplateDraft["metaCategory"] })}>
                          <option value="MARKETING">Marketing</option>
                          <option value="UTILITY">Utility</option>
                          <option value="AUTHENTICATION">Authentication</option>
                        </select>
                      </div>
                      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                        <span className="small muted">Status: {editing.meta_status ?? "Draft"}</span>
                        <Button variant="outline" onClick={submitToMeta} disabled={busy || !draftTpl.metaName.trim()}>
                          {busy ? "…" : "Submit to Meta"}
                        </Button>
                      </div>
                    </>
                  )}
                </div>

                <div className="flex min-w-0 flex-col gap-3">
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label>Preview</label>
                    {editing.channel === "email" && previewHtml ? (
                      <iframe title="Email preview" srcDoc={previewHtml} style={{ width: "100%", height: 360, border: "1px solid var(--border, #e0e0e0)", borderRadius: 8 }} />
                    ) : (
                      <div className="panel" style={{ background: "#dcf8c6", whiteSpace: "pre-wrap", fontSize: 14 }}>
                        {waPreviewText}
                      </div>
                    )}
                  </div>

                  {editing.channel === "email" && (
                    <div className="field" style={{ marginBottom: 0 }}>
                      <label htmlFor="testTo">Send a test email</label>
                      <div className="row" style={{ flexWrap: "nowrap" }}>
                        <input
                          id="testTo"
                          type="email"
                          value={testEmailTo}
                          onChange={(e) => {
                            setTestEmailTo(e.target.value);
                            setTestEmailStatus("idle");
                          }}
                          placeholder="you@example.com"
                          style={{ flex: 1 }}
                        />
                        <Button
                          variant="outline"
                          onClick={sendTestEmail}
                          disabled={testEmailStatus === "sending" || !testEmailTo.trim()}
                        >
                          <Send className="h-3.5 w-3.5" />
                          {testEmailStatus === "sending" ? "Sending…" : "Send test"}
                        </Button>
                      </div>
                      <p className="hint">Sends this draft as-is, with sample lead data, to the address above.</p>
                      {testEmailStatus === "sent" && (
                        <p className="small" style={{ color: "var(--ok)" }}>
                          Test email sent to {testEmailTo}.
                        </p>
                      )}
                      {testEmailStatus === "error" && (
                        <p className="small" style={{ color: "var(--bad)" }}>
                          {testEmailError}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
                <Button onClick={saveTemplate} disabled={busy}>
                  {busy ? "Saving…" : "Save"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
