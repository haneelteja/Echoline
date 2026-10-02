"use client";
import { useState } from "react";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { apiFetch, ApiError } from "@/lib/apiClient";
import type { SequenceSettingsRow } from "@/lib/types";

export default function SequencePage() {
  const { pid, seq, refreshProjectData } = useWorkspace();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [draft, setDraft] = useState<SequenceSettingsRow | null>(seq);

  if (!draft && seq) setDraft(seq);
  if (!draft) return <div className="empty">Loading…</div>;

  async function save() {
    if (!pid || !draft) return;
    setError(null);
    setSaved(false);
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
      setSaved(true);
      await refreshProjectData();
    } catch (e) {
      setError(e instanceof ApiError && e.status === 403 ? "You have view-only access and can't change the sequence." : "Save failed.");
    }
  }

  const col = (ch: "em" | "wa", label: string) => (
    <section className="panel">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 14 }}>
        <h2>{label}</h2>
        <label className="row small">
          <input
            type="checkbox"
            checked={draft[ch].enabled}
            onChange={(e) => setDraft({ ...draft, [ch]: { ...draft[ch], enabled: e.target.checked } })}
          />
          Active
        </label>
      </div>
      {draft[ch].steps.map((s, i) => (
        <div key={i} className="row small" style={{ marginBottom: 8 }}>
          <b>{["Initial", "Follow-up 1", "Follow-up 2", "Follow-up 3"][i] ?? `Step ${i + 1}`}</b>
          {i === 0 ? (
            <span className="muted">sent immediately</span>
          ) : (
            <>
              wait
              <input
                className="inp"
                type="number"
                min={0}
                style={{ width: 64 }}
                value={s.delayDays}
                onChange={(e) => {
                  const steps = [...draft[ch].steps];
                  steps[i] = { delayDays: Math.max(0, Number(e.target.value) || 0) };
                  setDraft({ ...draft, [ch]: { ...draft[ch], steps } });
                }}
              />
              days
            </>
          )}
        </div>
      ))}
    </section>
  );

  return (
    <>
      <div className="top">
        <div>
          <h1>Sequence</h1>
          <p>When each message goes out. Email and WhatsApp run independently.</p>
        </div>
      </div>
      <div className="grid g2" style={{ marginBottom: 16 }}>
        {col("em", "Email")}
        {col("wa", "WhatsApp")}
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
        <button className="btn primary" onClick={save}>
          Save sequence
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
