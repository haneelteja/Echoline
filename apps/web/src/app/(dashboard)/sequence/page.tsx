"use client";
import { useEffect, useState } from "react";
import { Clock, File, Pencil, Send, X } from "lucide-react";
import { analyzeTemplate, emailHTML, emailHTMLFromRaw, fill, optimizeTemplate } from "@echoline/core";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { apiFetch, ApiError } from "@/lib/apiClient";
import { useKbAssets } from "@/lib/useKbAssets";
import { AssetPicker } from "@/components/AssetPicker";
import { providerInfo } from "@/lib/providerCatalog";
import type { ConnectionRow, SequenceSettingsRow, TemplateRow, TemplateVersionRow } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

type ChannelKey = "em" | "wa";
type GenChannel = "email" | "whatsapp";

const CH_LABEL: Record<ChannelKey, string> = { em: "Email", wa: "WhatsApp" };
const CH_TEMPLATE: Record<ChannelKey, GenChannel> = { em: "email", wa: "whatsapp" };

/** Step labels are computed, not a fixed list — steps can be added past the
 * original Initial + 3 follow-ups, and the label keeps making sense. */
function stepLabel(i: number): string {
  return i === 0 ? "Initial" : `Follow-up ${i}`;
}

/** Compact human summary for the wait-time trigger button — e.g. "2d 30m",
 * "90s", "5d". Omits any unit that's zero rather than padding with "0d 0m". */
function formatWait(s: { delayDays: number; delayMinutes?: number; delaySeconds?: number }): string {
  const parts: string[] = [];
  if (s.delayDays) parts.push(`${s.delayDays}d`);
  if (s.delayMinutes) parts.push(`${s.delayMinutes}m`);
  if (s.delaySeconds) parts.push(`${s.delaySeconds}s`);
  return parts.length ? parts.join(" ") : "0s";
}

interface TemplateDraft {
  name: string;
  subject: string;
  body: string;
  categoryLines: Record<string, string>;
  metaName: string;
  metaCategory: "MARKETING" | "UTILITY" | "AUTHENTICATION";
  headerAssetId: string | null;
  galleryAssetIds: string[];
  ccEmail: string;
  replyToEmail: string;
  isHtml: boolean;
  fromConnectionId: string | null;
  fromEmail: string | null;
}

interface ChannelDraft {
  enabled: boolean;
  dailyCap: number;
  window: { start: string; end: string };
  steps: { delayDays: number; delayMinutes?: number; delaySeconds?: number }[];
}

interface SeqDraft {
  em: ChannelDraft;
  wa: ChannelDraft;
}

/** Fills in a channel's dailyCap/window from the row's legacy shared columns
 * when a row predates migration 0038 and hasn't backfilled them yet — lets
 * the editable draft always treat these as present, never undefined. */
function withDefaults(s: SequenceSettingsRow): SeqDraft {
  const fill = (cfg: SequenceSettingsRow["em"]): ChannelDraft => ({
    enabled: cfg.enabled,
    steps: cfg.steps,
    dailyCap: cfg.dailyCap ?? s.daily_cap,
    window: cfg.window ?? { start: s.window_start.slice(0, 5), end: s.window_end.slice(0, 5) },
  });
  return { em: fill(s.em), wa: fill(s.wa) };
}

/** Maps a saved template row to its editable draft shape — shared by
 * openEditor (initial load) and saveTemplate (to reset the dirty-check
 * baseline after a successful save, without closing the editor). */
function toDraft(t: TemplateRow): TemplateDraft {
  return {
    name: t.name ?? "",
    subject: t.subject ?? "",
    body: t.body ?? "",
    categoryLines: t.category_lines ?? {},
    metaName: t.meta_name ?? "",
    metaCategory: "MARKETING",
    headerAssetId: t.header_asset_id,
    galleryAssetIds: t.gallery_asset_ids ?? [],
    ccEmail: t.cc_email ?? "",
    replyToEmail: t.reply_to_email ?? "",
    isHtml: t.body_is_html ?? false,
    fromConnectionId: t.from_connection_id ?? null,
    fromEmail: t.from_email ?? null,
  };
}

/** Flattens every connected email connection into pickable "From" options —
 * one per configured from_addresses entry (API-key providers like Resend,
 * where the address is caller-controlled), or one for the connection itself
 * when it has none (OAuth providers like Gmail/Outlook, where the From is
 * pinned to the authenticated account). Encodes both pieces a template
 * needs into one string so a single <select> can drive both fields. */
function fromOptionValue(connectionId: string, email: string | null): string {
  return `${connectionId}|${email ?? ""}`;
}
function parseFromOptionValue(value: string): { fromConnectionId: string | null; fromEmail: string | null } {
  if (!value) return { fromConnectionId: null, fromEmail: null };
  const sep = value.indexOf("|");
  const connectionId = sep >= 0 ? value.slice(0, sep) : value;
  const email = sep >= 0 ? value.slice(sep + 1) : "";
  return { fromConnectionId: connectionId, fromEmail: email || null };
}

export default function SequencePage() {
  const { pid, project, seq, templates, refreshProjectData } = useWorkspace();

  const [draft, setDraft] = useState<SeqDraft | null>(seq ? withDefaults(seq) : null);
  const [seqSaved, setSeqSaved] = useState(false);
  const [seqError, setSeqError] = useState<string | null>(null);

  // For the template editor's From picker — connections are org-shared
  // (not project-scoped), so fetched here keyed on org_id, same source
  // organization/page.tsx uses.
  const [emailConnections, setEmailConnections] = useState<ConnectionRow[]>([]);
  useEffect(() => {
    if (!project?.org_id) return;
    apiFetch<ConnectionRow[]>(`/v1/orgs/${project.org_id}/connections`)
      // Not status-filtered — a not-yet-connected connection's configured
      // From addresses still show up (disabled), so they're visible instead
      // of silently missing; see the picker below for the status check.
      .then((conns) => setEmailConnections(conns.filter((c) => c.kind === "email")))
      .catch(() => setEmailConnections([]));
  }, [project?.org_id]);
  const connectedEmailConnections = emailConnections.filter((c) => c.status === "connected");

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

  const { assets } = useKbAssets(pid);
  const [picking, setPicking] = useState<"header" | "gallery" | null>(null);
  const [editingWait, setEditingWait] = useState<{ ch: ChannelKey; index: number } | null>(null);
  const [showUnsavedConfirm, setShowUnsavedConfirm] = useState(false);
  // Email-only: clicking an empty step's "Choose / create template" opens a
  // small picker (blank vs. a saved library template) instead of creating a
  // blank template immediately.
  const [pickingLibraryFor, setPickingLibraryFor] = useState<{ ch: ChannelKey; index: number } | null>(null);

  const [versions, setVersions] = useState<TemplateVersionRow[]>([]);
  const [showVersions, setShowVersions] = useState(false);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [versionsError, setVersionsError] = useState<string | null>(null);

  // True whenever the open template editor's draft differs from the
  // last-saved row — gates the "save or discard?" prompt so a plain close
  // with no edits doesn't interrupt the user for nothing.
  const isTplDirty = !!editing && !!draftTpl && JSON.stringify(draftTpl) !== JSON.stringify(toDraft(editing));

  function requestCloseEditor() {
    if (isTplDirty) setShowUnsavedConfirm(true);
    else setEditing(null);
  }

  // Syncs the local draft once seq finishes loading (it's null on first
  // render — WorkspaceProvider fetches it async). Calling setState directly
  // during render worked but is a React anti-pattern and wouldn't re-sync
  // if seq changed again later; this effect does, correctly.
  useEffect(() => {
    if (seq) setDraft(withDefaults(seq));
  }, [seq]);

  if (!draft) return <div className="empty">Loading…</div>;

  async function saveSequence() {
    if (!pid || !draft) return;
    setSeqError(null);
    setSeqSaved(false);
    try {
      await apiFetch(`/v1/projects/${pid}/sequence`, {
        method: "PUT",
        body: JSON.stringify({ em: draft.em, wa: draft.wa }),
      });
      setSeqSaved(true);
      await refreshProjectData();
    } catch (e) {
      setSeqError(e instanceof ApiError && e.status === 403 ? "You have view-only access and can't change the sequence." : "Save failed.");
    }
  }

  function templateFor(ch: ChannelKey, step: number): TemplateRow | null {
    return templates.find((t) => t.channel === CH_TEMPLATE[ch] && t.step === step && !t.is_library) ?? null;
  }

  const emailLibraryTemplates = templates.filter((t) => t.channel === "email" && t.is_library);

  function openEditor(t: TemplateRow) {
    setEditing(t);
    setDraftTpl(toDraft(t));
    setTplError(null);
    setTestEmailTo("");
    setTestEmailStatus("idle");
    setTestEmailError(null);
    setVersions([]);
    setShowVersions(false);
    setVersionsError(null);
  }

  async function openVersionHistory() {
    if (!pid || !editing) return;
    setShowVersions(true);
    setLoadingVersions(true);
    setVersionsError(null);
    try {
      const list = await apiFetch<TemplateVersionRow[]>(`/v1/projects/${pid}/templates/${editing.id}/versions`);
      setVersions(list);
    } catch {
      setVersionsError("Couldn't load version history.");
    } finally {
      setLoadingVersions(false);
    }
  }

  async function revertToVersion(versionId: string) {
    if (!pid || !editing) return;
    setBusy(true);
    setVersionsError(null);
    try {
      const updated = await apiFetch<TemplateRow>(`/v1/projects/${pid}/templates/${editing.id}/versions/${versionId}/revert`, { method: "POST" });
      setEditing(updated);
      setDraftTpl(toDraft(updated));
      await refreshProjectData();
      setShowVersions(false);
    } catch {
      setVersionsError("Couldn't revert to that version.");
    } finally {
      setBusy(false);
    }
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
          name: stepLabel(step),
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

  /** Creates a step-bound template pre-filled from a saved library entry —
   * an independent copy: editing the step afterward never touches the
   * library original or any other step that started from the same one. */
  async function createTemplateFromLibrary(ch: ChannelKey, step: number, lib: TemplateRow) {
    if (!pid) return;
    setBusy(true);
    setTplError(null);
    try {
      const created = await apiFetch<TemplateRow>(`/v1/projects/${pid}/templates`, {
        method: "POST",
        body: JSON.stringify({
          channel: CH_TEMPLATE[ch],
          step,
          name: lib.name || stepLabel(step),
          subject: lib.subject ?? "",
          body: lib.body ?? "",
          category_lines: lib.category_lines ?? {},
          header_asset_id: lib.header_asset_id,
          gallery_asset_ids: lib.gallery_asset_ids ?? [],
          cc_email: lib.cc_email,
          reply_to_email: lib.reply_to_email,
          body_is_html: lib.body_is_html,
          from_connection_id: lib.from_connection_id,
          from_email: lib.from_email,
        }),
      });
      await refreshProjectData();
      setPickingLibraryFor(null);
      openEditor(created);
    } catch (e) {
      setTplError(e instanceof ApiError && e.status === 403 ? "You have view-only access and can't create templates." : "Couldn't create template.");
    } finally {
      setBusy(false);
    }
  }

  /** Creates a new, blank saved email template — not bound to any sequence
   * step, listed in the "Saved email templates" library below the Email
   * flow so it can be applied as a starting point for a future step. */
  async function createLibraryTemplate() {
    if (!pid) return;
    setBusy(true);
    setTplError(null);
    try {
      const created = await apiFetch<TemplateRow>(`/v1/projects/${pid}/templates`, {
        method: "POST",
        body: JSON.stringify({
          channel: "email",
          step: 0,
          is_library: true,
          name: "New saved template",
          subject: "",
          body: "",
          category_lines: {},
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

  async function deleteLibraryTemplate(id: string) {
    if (!pid) return;
    setBusy(true);
    setTplError(null);
    try {
      await apiFetch(`/v1/projects/${pid}/templates/${id}`, { method: "DELETE" });
      await refreshProjectData();
    } catch (e) {
      setTplError(e instanceof ApiError && e.status === 403 ? "You have view-only access and can't delete templates." : "Couldn't delete template.");
    } finally {
      setBusy(false);
    }
  }

  /** Saves and keeps the editor open (resetting the dirty-check baseline to
   * the just-saved values) — closing is a separate, explicit action now, not
   * a side effect of Save. Returns whether the save succeeded, so the
   * unsaved-changes confirm dialog's "Save & close" can know whether it's
   * safe to also close afterward. */
  async function saveTemplate(): Promise<boolean> {
    if (!pid || !editing || !draftTpl) return false;
    setBusy(true);
    setTplError(null);
    try {
      const updated = await apiFetch<TemplateRow>(`/v1/projects/${pid}/templates/${editing.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: draftTpl.name,
          subject: draftTpl.subject,
          body: draftTpl.body,
          category_lines: draftTpl.categoryLines,
          header_asset_id: draftTpl.headerAssetId,
          gallery_asset_ids: draftTpl.galleryAssetIds,
          cc_email: draftTpl.ccEmail.trim() || null,
          reply_to_email: draftTpl.replyToEmail.trim() || null,
          body_is_html: draftTpl.isHtml,
          from_connection_id: draftTpl.fromConnectionId,
          from_email: draftTpl.fromEmail,
        }),
      });
      setEditing(updated);
      setDraftTpl(toDraft(updated));
      await refreshProjectData();
      return true;
    } catch (e) {
      setTplError(e instanceof ApiError && e.status === 403 ? "You have view-only access and can't edit templates." : "Couldn't save");
      return false;
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
              ? "Connect an AI provider under Connections → AI first."
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
          ? "Connect an AI provider under Connections → AI first."
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
        body: JSON.stringify({
          to: testEmailTo.trim(),
          subject: draftTpl.subject,
          body: draftTpl.body,
          categoryLines: draftTpl.categoryLines,
          galleryAssetIds: draftTpl.galleryAssetIds,
          cc: draftTpl.ccEmail.trim() || undefined,
          replyTo: draftTpl.replyToEmail.trim() || undefined,
          isHtml: draftTpl.isHtml,
          fromConnectionId: draftTpl.fromConnectionId ?? undefined,
          fromEmail: draftTpl.fromEmail ?? undefined,
        }),
      });
      setTestEmailStatus("sent");
    } catch (e) {
      setTestEmailStatus("error");
      setTestEmailError(
        e instanceof ApiError
          ? e.body && typeof e.body === "object" && "error" in e.body && (e.body as { error?: string }).error === "no_connection"
            ? "Connect an email provider under Connections first."
            : e.message
          : "Couldn't send test email."
      );
    }
  }

  // Shared by previewHtml and previewSubject below so the subject line shown
  // in the mock inbox header above the iframe is filled with the exact same
  // sample contact/project data as the body — otherwise a stray {{company}}
  // left in the subject wouldn't be caught until a real test send.
  const previewCtx =
    editing && draftTpl && editing.channel === "email" && project
      ? {
          project: { name: project.name, brand: project.brand, senderName: project.sender_name, website: project.website, waNumber: project.wa_number, accent: project.accent },
          contact: { name: "Acme Corp", area: "Gachibowli", category: "Restaurant" },
          template: { categoryLines: draftTpl.categoryLines },
        }
      : null;

  const previewHtml =
    previewCtx && draftTpl
      ? draftTpl.isHtml
        ? emailHTMLFromRaw(draftTpl.body, previewCtx)
        : emailHTML(
            { body: draftTpl.body },
            previewCtx,
            { galleryUrls: draftTpl.galleryAssetIds.map((aid) => assets.find((a) => a.id === aid)?.url).filter((u): u is string => Boolean(u)) }
          )
      : null;

  const previewSubject = previewCtx && draftTpl ? fill(draftTpl.subject, previewCtx) : "";

  const waPreviewText =
    editing && draftTpl && editing.channel === "whatsapp" && project
      ? fill(draftTpl.body, {
          project: { name: project.name, brand: project.brand, senderName: project.sender_name, website: project.website, waNumber: project.wa_number, accent: project.accent },
          contact: { name: "Acme Corp", area: "Gachibowli", category: "Restaurant" },
          template: { categoryLines: draftTpl.categoryLines },
        })
      : null;

  // Only meaningful for email — these heuristics target Gmail's Promotions-
  // tab classifier specifically, not WhatsApp.
  const deliverabilityFindings =
    editing && draftTpl && editing.channel === "email" ? analyzeTemplate({ subject: draftTpl.subject, body: draftTpl.body, isHtml: draftTpl.isHtml }) : [];

  function applyOptimize() {
    if (!draftTpl) return;
    const { subject, body } = optimizeTemplate({ subject: draftTpl.subject, body: draftTpl.body, isHtml: draftTpl.isHtml });
    setDraftTpl({ ...draftTpl, subject, body });
  }

  function addStep(ch: ChannelKey) {
    const chDraft = draft![ch];
    setDraft({ ...draft!, [ch]: { ...chDraft, steps: [...chDraft.steps, { delayDays: 3 }] } });
  }

  function removeLastStep(ch: ChannelKey) {
    const chDraft = draft![ch];
    if (chDraft.steps.length <= 1) return;
    setDraft({ ...draft!, [ch]: { ...chDraft, steps: chDraft.steps.slice(0, -1) } });
  }

  function column(ch: ChannelKey) {
    const chDraft = draft![ch];
    const steps = chDraft.steps;

    // Horizontal flow: each step is a card, with a wait-time connector
    // between consecutive cards — Initial, then a connector, then Follow-up
    // 1, and so on. Cards grow to fill the row's full width (only the
    // connectors have a fixed size); flex-wrap folds the row onto multiple
    // lines on narrower screens instead of forcing horizontal scroll. Adding
    // or removing a step re-renders this automatically since it's driven
    // entirely off `steps`.
    const flowNodes = steps.flatMap((s, i) => {
      const tpl = templateFor(ch, i);
      const isLast = i === steps.length - 1;
      const nodes = [];
      if (i > 0) {
        nodes.push(
          <div key={`wait-${i}`} className="flex flex-col items-center justify-center" style={{ minWidth: 64, flex: "0 0 auto", padding: "0 4px" }}>
            <div style={{ height: 1, width: "100%", minWidth: 24, background: "var(--line)" }} />
            <button
              type="button"
              className="row small"
              style={{ gap: 6, margin: "6px 0", padding: "4px 10px", borderRadius: 999, border: "1px solid var(--line)", background: "var(--bg)", whiteSpace: "nowrap" }}
              onClick={() => setEditingWait({ ch, index: i })}
            >
              <Clock className="h-3 w-3" />
              wait {formatWait(s)}
              <Pencil className="h-3 w-3" style={{ opacity: 0.6 }} />
            </button>
            <div style={{ height: 1, width: "100%", minWidth: 24, background: "var(--line)" }} />
          </div>
        );
      }
      nodes.push(
        <div
          key={`step-${i}`}
          className="flex flex-col"
          style={{ gap: 6, minWidth: 190, flex: "1 1 190px", padding: 12, border: "1px solid var(--border, #e8e8e8)", borderRadius: 10, position: "relative" }}
        >
          {isLast && steps.length > 1 && (
            <button
              type="button"
              className="btn small danger"
              style={{ position: "absolute", top: -8, right: -8, padding: 2, borderRadius: "50%" }}
              onClick={() => removeLastStep(ch)}
              aria-label="Remove this step"
              title="Remove this step"
            >
              <X className="h-3 w-3" />
            </button>
          )}
          <b className="small">{stepLabel(i)}</b>
          <span className="small muted">{i === 0 ? "sent immediately" : `${formatWait(s)} after the previous step`}</span>
          {tpl ? (
            <>
              <div className="small">
                <b>{tpl.name || "Untitled"}</b>
                {tpl.ai ? " · AI" : ""}
                {ch === "wa" && tpl.meta_status ? ` · ${tpl.meta_status}` : ""}
              </div>
              <button className="btn small" onClick={() => openEditor(tpl)}>
                Edit template
              </button>
            </>
          ) : ch === "em" ? (
            <button className="btn small" disabled={busy} onClick={() => setPickingLibraryFor({ ch, index: i })}>
              Choose / create template
            </button>
          ) : (
            <button className="btn small" disabled={busy} onClick={() => createTemplate(ch, i)}>
              Choose / create template
            </button>
          )}
        </div>
      );
      return nodes;
    });

    flowNodes.push(
      <div key="add-step" className="flex flex-col items-center justify-center" style={{ minWidth: 64, flex: "0 0 auto", padding: "0 4px" }}>
        <button
          type="button"
          className="row small"
          style={{ gap: 6, padding: "4px 10px", borderRadius: 999, border: "1px dashed var(--line)", background: "var(--bg)", whiteSpace: "nowrap" }}
          onClick={() => addStep(ch)}
        >
          + Add follow-up
        </button>
      </div>
    );

    return (
      <section className="panel" key={ch}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 14 }}>
          <h2>{CH_LABEL[ch]}</h2>
          <div className="row small" style={{ gap: 10 }}>
            <label className="row small">
              <input
                type="checkbox"
                checked={chDraft.enabled}
                onChange={(e) => setDraft({ ...draft!, [ch]: { ...chDraft, enabled: e.target.checked } })}
              />
              Active
            </label>
            <button className="btn small" onClick={() => setGenerating(CH_TEMPLATE[ch])}>
              Generate with AI
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-start" style={{ gap: 4, marginBottom: 20 }}>
          {flowNodes}
        </div>

        <div style={{ borderTop: "1px solid var(--border, #e8e8e8)", paddingTop: 14 }}>
          <h3 className="small" style={{ marginBottom: 10, fontWeight: 600 }}>
            {CH_LABEL[ch]} sending rules
          </h3>
          <div className="grid g3">
            <div className="field">
              <label htmlFor={`cap-${ch}`}>Daily cap</label>
              <input
                id={`cap-${ch}`}
                type="number"
                min={1}
                value={chDraft.dailyCap}
                onChange={(e) => setDraft({ ...draft!, [ch]: { ...chDraft, dailyCap: Math.max(1, Number(e.target.value) || 1) } })}
              />
            </div>
            <div className="field">
              <label htmlFor={`ws-${ch}`}>Send window start</label>
              <input
                id={`ws-${ch}`}
                type="time"
                value={chDraft.window.start}
                onChange={(e) => setDraft({ ...draft!, [ch]: { ...chDraft, window: { ...chDraft.window, start: e.target.value } } })}
              />
            </div>
            <div className="field">
              <label htmlFor={`we-${ch}`}>Send window end</label>
              <input
                id={`we-${ch}`}
                type="time"
                value={chDraft.window.end}
                onChange={(e) => setDraft({ ...draft!, [ch]: { ...chDraft, window: { ...chDraft.window, end: e.target.value } } })}
              />
            </div>
          </div>
        </div>

        {ch === "em" && (
          <div style={{ borderTop: "1px solid var(--border, #e8e8e8)", paddingTop: 14, marginTop: 14 }}>
            <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
              <h3 className="small" style={{ fontWeight: 600 }}>
                Saved email templates
              </h3>
              <button className="btn small" disabled={busy} onClick={createLibraryTemplate}>
                + New saved template
              </button>
            </div>
            {emailLibraryTemplates.length === 0 ? (
              <p className="hint">No saved templates yet — create one here to reuse it as a starting point for any step above.</p>
            ) : (
              <div className="flex flex-col" style={{ gap: 6 }}>
                {emailLibraryTemplates.map((t) => (
                  <div
                    key={t.id}
                    className="row"
                    style={{ justifyContent: "space-between", gap: 10, padding: "8px 10px", border: "1px solid var(--border, #e8e8e8)", borderRadius: 8 }}
                  >
                    <div className="small">
                      <b>{t.name || "Untitled"}</b>
                      {t.subject ? ` — ${t.subject}` : ""}
                    </div>
                    <div className="row small" style={{ gap: 6 }}>
                      <button className="btn small" onClick={() => openEditor(t)}>
                        Edit
                      </button>
                      <button className="btn small danger" disabled={busy} onClick={() => deleteLibraryTemplate(t.id)}>
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>
    );
  }

  return (
    <>
      <div className="top">
        <div>
          <h1>Sequence &amp; Templates</h1>
          <p>When each message goes out, and what it says. Email and WhatsApp run independently.</p>
          <p className="hint" style={{ marginTop: 4 }}>
            Follow-up waits add days + minutes + seconds together. The scheduler checks for due sends every ~5
            minutes, so very short waits (seconds, low minutes) won&apos;t fire instantly — useful for quick
            testing, not sub-5-minute precision.
          </p>
        </div>
      </div>

      {tplError && (
        <p className="small" style={{ color: "var(--bad)", marginBottom: 12 }}>
          {tplError}
        </p>
      )}

      {/* Stacked, not side-by-side — each channel's horizontal step flow
          needs the full page width to read well and wrap sensibly. */}
      <div className="flex flex-col" style={{ gap: 16, marginBottom: 16 }}>
        {column("em")}
        {column("wa")}
      </div>

      <section className="panel">
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

      <Dialog open={!!(editing && draftTpl)} onOpenChange={(open) => !open && requestCloseEditor()}>
        <DialogContent className="max-w-6xl max-h-[92vh]">
          {editing && draftTpl && (
            <>
              <DialogHeader>
                <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                  <DialogTitle>Edit {editing.channel === "email" ? "email" : "WhatsApp"} template</DialogTitle>
                  <button type="button" className="btn small" onClick={openVersionHistory} style={{ marginRight: 24 }}>
                    Version history
                  </button>
                </div>
              </DialogHeader>
              <div className="grid gap-8 lg:grid-cols-[1fr_440px]">
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
                  {editing.channel === "email" && (
                    <div className="field">
                      <label htmlFor="tfrom">From</label>
                      <select
                        id="tfrom"
                        value={draftTpl.fromConnectionId ? fromOptionValue(draftTpl.fromConnectionId, draftTpl.fromEmail) : ""}
                        onChange={(e) => setDraftTpl({ ...draftTpl, ...parseFromOptionValue(e.target.value) })}
                      >
                        <option value="">
                          {connectedEmailConnections.length > 1
                            ? "Choose a From address…"
                            : connectedEmailConnections.length === 1
                              ? `Default — ${connectedEmailConnections[0].account_label || providerInfo(connectedEmailConnections[0].provider)?.label || connectedEmailConnections[0].provider}`
                              : "No connection is currently connected"}
                        </option>
                        {emailConnections.flatMap((c) => {
                          const disabled = c.status !== "connected";
                          const suffix = disabled ? " (not connected)" : "";
                          return c.from_addresses?.length
                            ? c.from_addresses.map((addr) => (
                                <option key={fromOptionValue(c.id, addr)} value={fromOptionValue(c.id, addr)} disabled={disabled}>
                                  {addr}
                                  {suffix}
                                </option>
                              ))
                            : [
                                <option key={fromOptionValue(c.id, null)} value={fromOptionValue(c.id, null)} disabled={disabled}>
                                  {(c.account_label || providerInfo(c.provider)?.label || c.provider) + suffix}
                                </option>,
                              ];
                        })}
                      </select>
                      <p className="hint">
                        {connectedEmailConnections.length > 1
                          ? "Which connected email address this step sends from — required once more than one is connected."
                          : connectedEmailConnections.length === 1
                            ? "This step currently sends from your only connected email account — go to Organization to connect another or add more From addresses to it."
                            : emailConnections.length > 0
                              ? "None of your configured email connections are connected yet — test one on the Organization page to enable sending (greyed-out addresses below belong to those)."
                              : "Connect an email provider on the Organization page before this step can send."}
                      </p>
                    </div>
                  )}
                  {editing.channel === "email" && (
                    <div className="field">
                      <label htmlFor="tcc">CC</label>
                      <input
                        id="tcc"
                        type="email"
                        value={draftTpl.ccEmail}
                        onChange={(e) => setDraftTpl({ ...draftTpl, ccEmail: e.target.value })}
                        placeholder="e.g. sales-rep@yourcompany.com"
                      />
                      <p className="hint">CCs this address on every send of this step. Leave blank for no CC.</p>
                    </div>
                  )}
                  {editing.channel === "email" && (
                    <div className="field">
                      <label htmlFor="trt">Reply to</label>
                      <input
                        id="trt"
                        type="email"
                        value={draftTpl.replyToEmail}
                        onChange={(e) => setDraftTpl({ ...draftTpl, replyToEmail: e.target.value })}
                        placeholder="e.g. sales-rep@yourcompany.com"
                      />
                      <p className="hint">
                        Replies to this step land here instead of the project&apos;s default reply-to. Leave blank to use the project default.
                      </p>
                    </div>
                  )}
                  <div className="field">
                    <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
                      <label htmlFor="tb">Body</label>
                      {editing.channel === "email" && (
                        <div className="row" style={{ gap: 4 }}>
                          <Button type="button" size="sm" variant={draftTpl.isHtml ? "outline" : "default"} onClick={() => setDraftTpl({ ...draftTpl, isHtml: false })}>
                            Plain text
                          </Button>
                          <Button type="button" size="sm" variant={draftTpl.isHtml ? "default" : "outline"} onClick={() => setDraftTpl({ ...draftTpl, isHtml: true })}>
                            Raw HTML
                          </Button>
                        </div>
                      )}
                    </div>
                    <textarea
                      id="tb"
                      style={{ minHeight: 320, fontFamily: draftTpl.isHtml ? "monospace" : undefined }}
                      value={draftTpl.body}
                      onChange={(e) => setDraftTpl({ ...draftTpl, body: e.target.value })}
                    />
                    {editing.channel === "email" && draftTpl.isHtml && (
                      <p className="hint">
                        Sent close to as-is (after {"{{placeholders}}"} are filled in) — write your own markup, including custom buttons or links. A plain
                        opt-out footer is still added automatically.
                      </p>
                    )}
                  </div>
                  {editing.channel === "email" && deliverabilityFindings.length > 0 && (
                    <div className="field" style={{ background: "var(--bad-soft)", borderRadius: 8, padding: "10px 14px" }}>
                      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                        <label style={{ margin: 0, color: "var(--bad)" }}>Inbox placement check — {deliverabilityFindings.length} issue(s) found</label>
                        {deliverabilityFindings.some((f) => f.fixable) && (
                          <Button type="button" size="sm" onClick={applyOptimize}>
                            Optimize
                          </Button>
                        )}
                      </div>
                      <ul style={{ margin: "8px 0 0", paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6 }}>
                        {deliverabilityFindings.map((f) => (
                          <li key={f.id} className="hint">
                            {f.message}
                            {!f.fixable && " (not auto-fixable — needs a manual rewrite.)"}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {editing.channel === "email" && deliverabilityFindings.length === 0 && (draftTpl.subject.trim() || draftTpl.body.trim()) && (
                    <p className="hint" style={{ color: "var(--ok)" }}>
                      ✓ No known Promotions-tab signals detected in this template.
                    </p>
                  )}
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
                    <label>{editing.channel === "email" ? "Gallery images" : "Additional images / files"}</label>
                    <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
                      {draftTpl.galleryAssetIds.map((aid) => {
                        const a = assets.find((x) => x.id === aid);
                        return (
                          <div key={aid} style={{ position: "relative" }}>
                            {a?.kind === "document" ? (
                              <div
                                className="row"
                                style={{ width: 64, height: 64, alignItems: "center", justifyContent: "center", border: "1px solid var(--line)", borderRadius: 6 }}
                                title={a.name}
                              >
                                <File className="h-6 w-6" style={{ color: "var(--muted)" }} />
                              </div>
                            ) : (
                              <img
                                src={a?.url}
                                alt={a?.name ?? ""}
                                style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 6, border: "1px solid var(--line)" }}
                              />
                            )}
                            <button
                              className="btn small danger"
                              style={{ position: "absolute", top: -6, right: -6, padding: 2, borderRadius: "50%" }}
                              onClick={() => setDraftTpl({ ...draftTpl, galleryAssetIds: draftTpl.galleryAssetIds.filter((id) => id !== aid) })}
                              aria-label="Remove"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        );
                      })}
                      <button className="btn small" onClick={() => setPicking("gallery")}>
                        + Add {editing.channel === "email" ? "images" : "images / files"}
                      </button>
                    </div>
                    <p className="hint">
                      {editing.channel === "email"
                        ? "Sent as real file attachments, not embedded in the email body — inline images are a known Promotions-tab signal, so they're kept out of the rendered HTML."
                        : "Only sent by free-text providers (e.g. 360Messenger) — Meta's official template header is capped at one image/document, so these are ignored for Meta sends. Sent as the first item + text together, then one message per remaining item."}
                    </p>
                  </div>

                  {editing.channel === "whatsapp" && (
                    <div className="field">
                      <label>Header media</label>
                      {draftTpl.headerAssetId ? (
                        (() => {
                          const a = assets.find((x) => x.id === draftTpl.headerAssetId);
                          return (
                            <div className="row" style={{ gap: 10 }}>
                              {a?.kind === "image" ? (
                                <img src={a.url} alt={a.name} style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 6, border: "1px solid var(--line)" }} />
                              ) : (
                                <div className="row" style={{ width: 64, height: 64, alignItems: "center", justifyContent: "center", border: "1px solid var(--line)", borderRadius: 6 }}>
                                  <File className="h-6 w-6" style={{ color: "var(--muted)" }} />
                                </div>
                              )}
                              <span className="small">{a?.name ?? "Selected file"}</span>
                              <button className="btn small" onClick={() => setDraftTpl({ ...draftTpl, headerAssetId: null })}>
                                Remove
                              </button>
                            </div>
                          );
                        })()
                      ) : (
                        <button className="btn small" onClick={() => setPicking("header")}>
                          + Choose image or document
                        </button>
                      )}
                      <p className="hint">Shown at the top of the message. Images submit for approval directly; documents too.</p>
                    </div>
                  )}

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
                      <div style={{ border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden", background: "#fff" }}>
                        <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "12px 14px", borderBottom: "1px solid #ececec" }}>
                          <div
                            style={{
                              width: 32,
                              height: 32,
                              borderRadius: "50%",
                              background: project?.accent || "#4f46e5",
                              color: "#fff",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: 13,
                              fontWeight: 600,
                              flexShrink: 0,
                            }}
                          >
                            {(project?.sender_name || project?.brand || project?.name || "?").trim().charAt(0).toUpperCase()}
                          </div>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                              <span style={{ fontSize: 13, fontWeight: 600, color: "#1a1a1a" }}>
                                {project?.sender_name || project?.brand || project?.name}
                              </span>
                              <span style={{ fontSize: 11, color: "#8a8a8a", flexShrink: 0 }}>now</span>
                            </div>
                            <div style={{ fontSize: 12, color: "#8a8a8a" }}>to Acme Corp</div>
                            <div style={{ fontSize: 14, fontWeight: 600, color: "#1a1a1a", marginTop: 6, overflowWrap: "anywhere" }}>{previewSubject}</div>
                          </div>
                        </div>
                        <iframe
                          title="Email preview"
                          srcDoc={previewHtml}
                          style={{ width: "100%", height: 420, border: "none", display: "block", padding: "18px 16px", boxSizing: "border-box", background: "#fff" }}
                        />
                      </div>
                    ) : (
                      <div className="panel" style={{ background: "#dcf8c6", fontSize: 14 }}>
                        {draftTpl.headerAssetId &&
                          (() => {
                            const a = assets.find((x) => x.id === draftTpl.headerAssetId);
                            if (!a) return null;
                            return a.kind === "image" ? (
                              <img src={a.url} alt={a.name} style={{ width: "100%", borderRadius: 6, marginBottom: 8 }} />
                            ) : (
                              <div className="row small" style={{ gap: 6, marginBottom: 8 }}>
                                <File className="h-4 w-4" />
                                {a.name}
                              </div>
                            );
                          })()}
                        <div style={{ whiteSpace: "pre-wrap" }}>{waPreviewText}</div>
                        {draftTpl.galleryAssetIds.length > 0 && (
                          <div className="row" style={{ flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                            {draftTpl.galleryAssetIds.map((aid) => {
                              const a = assets.find((x) => x.id === aid);
                              if (!a) return null;
                              return a.kind === "image" ? (
                                <img key={aid} src={a.url} alt={a.name} style={{ width: 70, height: 70, objectFit: "cover", borderRadius: 6 }} />
                              ) : (
                                <div
                                  key={aid}
                                  className="row small"
                                  style={{ width: 70, height: 70, alignItems: "center", justifyContent: "center", border: "1px solid rgba(0,0,0,.1)", borderRadius: 6, textAlign: "center" }}
                                  title={a.name}
                                >
                                  <File className="h-5 w-5" />
                                </div>
                              );
                            })}
                          </div>
                        )}
                        <p className="hint" style={{ marginTop: 6 }}>Each additional item sends as a separate message (free-text providers only).</p>
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
              {tplError && (
                <p className="small" style={{ color: "var(--bad)" }}>
                  {tplError}
                </p>
              )}
              <DialogFooter>
                {isTplDirty && <span className="small muted" style={{ marginRight: "auto", alignSelf: "center" }}>Unsaved changes</span>}
                <Button variant="outline" onClick={requestCloseEditor}>
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

      <Dialog open={showUnsavedConfirm} onOpenChange={(open) => !open && setShowUnsavedConfirm(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Unsaved changes</DialogTitle>
            <DialogDescription>Save your changes to this template before closing, or discard them?</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowUnsavedConfirm(false);
                setEditing(null);
              }}
            >
              Discard changes
            </Button>
            <Button
              onClick={async () => {
                const ok = await saveTemplate();
                setShowUnsavedConfirm(false);
                if (ok) setEditing(null);
              }}
              disabled={busy}
            >
              {busy ? "Saving…" : "Save & close"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pickingLibraryFor !== null} onOpenChange={(open) => !open && setPickingLibraryFor(null)}>
        <DialogContent className="max-w-md">
          {pickingLibraryFor && (
            <>
              <DialogHeader>
                <DialogTitle>{stepLabel(pickingLibraryFor.index)} — choose a template</DialogTitle>
                <DialogDescription>Start blank, or from one of your saved email templates.</DialogDescription>
              </DialogHeader>
              <div className="flex flex-col" style={{ gap: 8 }}>
                <button
                  className="btn small"
                  disabled={busy}
                  onClick={() => {
                    const { ch, index } = pickingLibraryFor;
                    setPickingLibraryFor(null);
                    createTemplate(ch, index);
                  }}
                >
                  Start blank
                </button>
                {emailLibraryTemplates.length === 0 ? (
                  <p className="hint">No saved templates yet.</p>
                ) : (
                  emailLibraryTemplates.map((t) => (
                    <button
                      key={t.id}
                      className="btn small"
                      disabled={busy}
                      onClick={() => createTemplateFromLibrary(pickingLibraryFor.ch, pickingLibraryFor.index, t)}
                    >
                      {t.name || "Untitled"}
                      {t.subject ? ` — ${t.subject}` : ""}
                    </button>
                  ))
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setPickingLibraryFor(null)}>
                  Cancel
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showVersions} onOpenChange={(open) => !open && setShowVersions(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Version history</DialogTitle>
            <DialogDescription>Every past save of this template. Revert to bring an older version back as the current one.</DialogDescription>
          </DialogHeader>
          {loadingVersions ? (
            <p className="small muted">Loading…</p>
          ) : versions.length === 0 ? (
            <p className="hint">No earlier versions yet — this template hasn&apos;t been saved since it was created.</p>
          ) : (
            <div className="flex flex-col" style={{ gap: 8, maxHeight: 360, overflowY: "auto" }}>
              {versions.map((v, i) => (
                <div
                  key={v.id}
                  className="row"
                  style={{ justifyContent: "space-between", gap: 10, padding: "8px 10px", border: "1px solid var(--border, #e8e8e8)", borderRadius: 8 }}
                >
                  <div className="small">
                    <b>{i === 0 ? "Current" : `${new Date(v.created_at).toLocaleString()}`}</b>
                    {v.subject ? ` — ${v.subject}` : ""}
                  </div>
                  {i > 0 && (
                    <Button variant="outline" size="sm" disabled={busy} onClick={() => revertToVersion(v.id)}>
                      Revert to this version
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
          {versionsError && (
            <p className="small" style={{ color: "var(--bad)" }}>
              {versionsError}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowVersions(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {draftTpl && (
        <AssetPicker
          pid={pid}
          open={picking !== null}
          onClose={() => setPicking(null)}
          mode={picking === "header" ? "single" : "multi"}
          kindFilter={picking === "header" || editing?.channel === "whatsapp" ? "all" : "image"}
          initialSelected={picking === "header" ? (draftTpl.headerAssetId ? [draftTpl.headerAssetId] : []) : draftTpl.galleryAssetIds}
          onConfirm={(ids) => {
            if (picking === "header") setDraftTpl({ ...draftTpl, headerAssetId: ids[0] ?? null });
            else setDraftTpl({ ...draftTpl, galleryAssetIds: ids });
          }}
        />
      )}

      <Dialog open={editingWait !== null} onOpenChange={(o) => !o && setEditingWait(null)}>
        <DialogContent className="max-w-sm">
          {editingWait && draft && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {CH_LABEL[editingWait.ch]} — {stepLabel(editingWait.index)} delay
                </DialogTitle>
                <DialogDescription>How long to wait after the previous step before sending this one.</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-3 gap-3">
                {(
                  [
                    ["delayDays", "Days"],
                    ["delayMinutes", "Minutes"],
                    ["delaySeconds", "Seconds"],
                  ] as const
                ).map(([field, label]) => {
                  const steps = draft[editingWait.ch].steps;
                  const value = steps[editingWait.index]?.[field] ?? 0;
                  return (
                    <div key={field} className="flex flex-col gap-1.5">
                      <Label htmlFor={`wait-${field}`}>{label}</Label>
                      <Input
                        id={`wait-${field}`}
                        type="number"
                        min={0}
                        value={value}
                        onChange={(e) => {
                          const next = [...steps];
                          next[editingWait.index] = { ...next[editingWait.index], [field]: Math.max(0, Number(e.target.value) || 0) };
                          setDraft({ ...draft, [editingWait.ch]: { ...draft[editingWait.ch], steps: next } });
                        }}
                      />
                    </div>
                  );
                })}
              </div>
              <DialogFooter>
                <Button onClick={() => setEditingWait(null)}>Done</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
