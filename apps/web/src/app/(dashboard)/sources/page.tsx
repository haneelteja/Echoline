"use client";
import { useState } from "react";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { apiFetch, ApiError } from "@/lib/apiClient";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export default function SourcesPage() {
  const { pid, sources, refreshProjectData } = useWorkspace();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<"webhook" | "form">("webhook");
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ sourceId: string; token: string } | null>(null);

  async function addSource() {
    if (!pid || !name.trim()) return;
    setError(null);
    try {
      await apiFetch(`/v1/projects/${pid}/sources`, {
        method: "POST",
        body: JSON.stringify({ name, type, config: {} }),
      });
      setName("");
      setAdding(false);
      await refreshProjectData();
    } catch (e) {
      setError(e instanceof ApiError && e.status === 403 ? "You have view-only access and can't add sources." : "Couldn't add source");
    }
  }

  async function generateToken(sourceId: string) {
    setError(null);
    try {
      const { token } = await apiFetch<{ token: string }>(`/v1/projects/${pid}/sources/${sourceId}/token`, { method: "POST" });
      setIssued({ sourceId, token });
    } catch {
      setError("Couldn't generate token");
    }
  }

  return (
    <>
      <div className="top">
        <div>
          <h1>Lead sources</h1>
          <p>Webhook and website-form intake are live. OneDrive/Sheets/CRM sync need provider credentials you haven't connected yet.</p>
        </div>
        <div className="row">
          <button className="btn primary" onClick={() => setAdding((v) => !v)}>
            Add source
          </button>
        </div>
      </div>

      {adding && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="grid g3">
            <div className="field">
              <label htmlFor="sn">Name</label>
              <input id="sn" value={name} onChange={(e) => setName(e.target.value)} placeholder="Website contact form" />
            </div>
            <div className="field">
              <label htmlFor="st">Type</label>
              <select id="st" value={type} onChange={(e) => setType(e.target.value as "webhook" | "form")}>
                <option value="webhook">Webhook</option>
                <option value="form">Website form</option>
              </select>
            </div>
          </div>
          <button className="btn primary" onClick={addSource} disabled={!name.trim()}>
            Save source
          </button>
          {error && (
            <p className="small" style={{ color: "var(--bad)", marginTop: 10 }}>
              {error}
            </p>
          )}
        </div>
      )}

      {issued && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <h3>Token generated — copy it now, it won&apos;t be shown again</h3>
          <p className="small muted">Send leads as JSON (webhooks) or a form POST (website forms) to:</p>
          <code style={{ display: "block", wordBreak: "break-all", margin: "8px 0" }}>
            POST {API_URL}/intake/{issued.sourceId}
          </code>
          <p className="small muted">
            Authenticate with <code>Authorization: Bearer {issued.token}</code>, or append <code>?token={issued.token}</code> for plain
            HTML forms. Body fields: <code>name</code> (required), <code>email</code>, <code>phone</code>, <code>category</code>,{" "}
            <code>area</code>, <code>contactPerson</code>.
          </p>
          <button className="btn" onClick={() => setIssued(null)}>
            Done
          </button>
        </div>
      )}

      {sources.length ? (
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>Source</th>
                <th>Type</th>
                <th>Sync</th>
                <th>Last sync</th>
                <th>Leads</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.id}>
                  <td>
                    <b>{s.name}</b>
                    <div className="hint">{s.detail}</div>
                  </td>
                  <td>{s.type}</td>
                  <td>{s.mode || "Manual"}</td>
                  <td className="small muted">{s.last_sync ? new Date(s.last_sync).toLocaleString() : "—"}</td>
                  <td>{s.rows_added}</td>
                  <td>
                    {(s.type === "webhook" || s.type === "form") && (
                      <button className="btn small" onClick={() => generateToken(s.id)}>
                        {s.last_sync ? "Rotate token" : "Generate token"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted small">No sources yet.</p>
      )}
    </>
  );
}
