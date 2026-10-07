"use client";
import { useEffect, useState } from "react";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { apiFetch, ApiError } from "@/lib/apiClient";
import type { ConnectionRow } from "@/lib/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type SourceType = "webhook" | "form" | "onedrive" | "google_sheets";

export default function SourcesPage() {
  const { pid, sources, loadingProject, refreshProjectData } = useWorkspace();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<SourceType>("webhook");
  const [path, setPath] = useState("");
  const [table, setTable] = useState("");
  const [spreadsheetId, setSpreadsheetId] = useState("");
  const [range, setRange] = useState("Sheet1!A1:Z");
  const [mode, setMode] = useState("Hourly");
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ sourceId: string; token: string } | null>(null);
  const [connections, setConnections] = useState<ConnectionRow[]>([]);
  const [syncingId, setSyncingId] = useState<string | null>(null);

  async function refreshConnections() {
    if (!pid) return;
    const data = await apiFetch<ConnectionRow[]>(`/v1/projects/${pid}/connections`);
    setConnections(data);
  }

  useEffect(() => {
    refreshConnections();
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("oauth_connected");
    const oauthError = params.get("oauth_error");
    if (connected) setError(null);
    else if (oauthError) setError(`Connection failed: ${oauthError.replace(/_/g, " ")}.`);
    if (connected || oauthError) window.history.replaceState({}, "", window.location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid]);

  const onedriveConn = connections.find((c) => c.kind === "onedrive" && c.status === "connected");
  const sheetsConn = connections.find((c) => c.kind === "google_sheets" && c.status === "connected");

  async function startOAuth(provider: "onedrive" | "google_sheets") {
    if (!pid) return;
    setError(null);
    try {
      const { url } = await apiFetch<{ url: string }>(`/v1/projects/${pid}/connections/oauth/${provider}/start`, { method: "POST" });
      window.location.href = url;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't start OAuth flow");
    }
  }

  async function addSource() {
    if (!pid || !name.trim()) return;
    setError(null);
    const config: Record<string, unknown> =
      type === "onedrive" ? { path, table } : type === "google_sheets" ? { spreadsheetId, range } : {};
    try {
      await apiFetch(`/v1/projects/${pid}/sources`, {
        method: "POST",
        body: JSON.stringify({ name, type, config, mode: type === "onedrive" || type === "google_sheets" ? mode : null }),
      });
      setName("");
      setPath("");
      setTable("");
      setSpreadsheetId("");
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

  async function syncNow(sourceId: string) {
    setError(null);
    setSyncingId(sourceId);
    try {
      await apiFetch(`/v1/projects/${pid}/sources/${sourceId}/sync`, { method: "POST" });
    } catch {
      setError("Couldn't trigger sync");
    } finally {
      setSyncingId(null);
    }
  }

  return (
    <>
      <div className="top">
        <div>
          <h1>Lead sources</h1>
          <p>Webhook, website-form, OneDrive, and Google Sheets intake are live. CRM sync (Zoho/HubSpot) isn&apos;t built yet.</p>
        </div>
        <div className="row">
          <button className="btn primary" onClick={() => setAdding((v) => !v)}>
            Add source
          </button>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <h3>Connect a sheet/workbook account</h3>
        <p className="small muted">Required once per project before adding a OneDrive or Google Sheets source.</p>
        <div className="row" style={{ marginTop: 10, gap: 10 }}>
          <button className="btn" onClick={() => startOAuth("onedrive")}>
            {onedriveConn ? "Reconnect OneDrive" : "Connect OneDrive"}
          </button>
          <button className="btn" onClick={() => startOAuth("google_sheets")}>
            {sheetsConn ? "Reconnect Google Sheets" : "Connect Google Sheets"}
          </button>
          {onedriveConn && <span className="pill ok">OneDrive connected</span>}
          {sheetsConn && <span className="pill ok">Google Sheets connected</span>}
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
              <select id="st" value={type} onChange={(e) => setType(e.target.value as SourceType)}>
                <option value="webhook">Webhook</option>
                <option value="form">Website form</option>
                <option value="onedrive">OneDrive (Excel table)</option>
                <option value="google_sheets">Google Sheets</option>
              </select>
            </div>
            {(type === "onedrive" || type === "google_sheets") && (
              <div className="field">
                <label htmlFor="smode">Sync frequency</label>
                <select id="smode" value={mode} onChange={(e) => setMode(e.target.value)}>
                  <option value="15 min">Every 15 minutes</option>
                  <option value="Hourly">Hourly</option>
                  <option value="Daily">Daily</option>
                </select>
              </div>
            )}
          </div>

          {type === "onedrive" && (
            <div className="grid g3" style={{ marginTop: 10 }}>
              <div className="field">
                <label htmlFor="odpath">Workbook path</label>
                <input id="odpath" value={path} onChange={(e) => setPath(e.target.value)} placeholder="/Leads/Master_Leads.xlsx" />
              </div>
              <div className="field">
                <label htmlFor="odtable">Table name</label>
                <input id="odtable" value={table} onChange={(e) => setTable(e.target.value)} placeholder="Table1" />
              </div>
            </div>
          )}
          {type === "google_sheets" && (
            <div className="grid g3" style={{ marginTop: 10 }}>
              <div className="field">
                <label htmlFor="gsid">Spreadsheet ID</label>
                <input id="gsid" value={spreadsheetId} onChange={(e) => setSpreadsheetId(e.target.value)} placeholder="From the sheet's URL" />
              </div>
              <div className="field">
                <label htmlFor="gsrange">Range</label>
                <input id="gsrange" value={range} onChange={(e) => setRange(e.target.value)} placeholder="Sheet1!A1:Z" />
              </div>
            </div>
          )}
          {type === "onedrive" && !onedriveConn && (
            <p className="small" style={{ color: "var(--bad)", marginTop: 10 }}>
              Connect a OneDrive account above first.
            </p>
          )}
          {type === "google_sheets" && !sheetsConn && (
            <p className="small" style={{ color: "var(--bad)", marginTop: 10 }}>
              Connect a Google Sheets account above first.
            </p>
          )}

          <button
            className="btn primary"
            style={{ marginTop: 10 }}
            onClick={addSource}
            disabled={
              !name.trim() ||
              (type === "onedrive" && (!onedriveConn || !path.trim() || !table.trim())) ||
              (type === "google_sheets" && (!sheetsConn || !spreadsheetId.trim() || !range.trim()))
            }
          >
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
          <p className="small muted">
            Bot protection: rate-limited to 20 submissions/minute per source. For website forms, add a hidden input named{" "}
            <code>website_url</code> left empty (a honeypot — real visitors never fill it in; bots usually fill every field):
          </p>
          <code style={{ display: "block", wordBreak: "break-all", margin: "4px 0" }}>
            {'<input type="text" name="website_url" style="display:none" tabindex="-1" autocomplete="off">'}
          </code>
          <button className="btn" onClick={() => setIssued(null)}>
            Done
          </button>
        </div>
      )}

      {loadingProject && sources.length === 0 ? (
        <p className="muted small">Loading…</p>
      ) : sources.length ? (
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>Source</th>
                <th>Type</th>
                <th>Sync</th>
                <th>Last sync</th>
                <th>Leads</th>
                <th>Skipped</th>
                <th>Failed</th>
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
                  <td className="small muted">{s.rows_skipped}</td>
                  <td className="small muted">{s.rows_failed}</td>
                  <td>
                    {(s.type === "webhook" || s.type === "form") && (
                      <button className="btn small" onClick={() => generateToken(s.id)}>
                        {s.last_sync ? "Rotate token" : "Generate token"}
                      </button>
                    )}
                    {(s.type === "onedrive" || s.type === "google_sheets") && (
                      <button className="btn small" disabled={syncingId === s.id} onClick={() => syncNow(s.id)}>
                        {syncingId === s.id ? "Syncing…" : "Sync now"}
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
