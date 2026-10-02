"use client";
import { useEffect, useState } from "react";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { apiFetch, ApiError } from "@/lib/apiClient";
import { PROVIDERS, providerInfo, type ProviderInfo } from "@/lib/providerCatalog";
import type { ConnectionRow } from "@/lib/types";

const STATUS_LABEL: Record<string, string> = {
  connected: "Connected",
  needs_reconnect: "Needs reconnect",
  disconnected: "Not connected",
};
const STATUS_TONE: Record<string, string> = {
  connected: "ok",
  needs_reconnect: "warn",
  disconnected: "warn",
};

export default function ChannelsPage() {
  const { pid } = useWorkspace();

  const [connections, setConnections] = useState<ConnectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<string | null>(null);
  const [adding, setAdding] = useState<ProviderInfo | null>(null);
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    if (!pid) return;
    setLoading(true);
    try {
      const data = await apiFetch<ConnectionRow[]>(`/v1/projects/${pid}/connections`);
      setConnections(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("oauth_connected");
    const oauthError = params.get("oauth_error");
    if (connected) {
      setBanner(`Connected ${connected === "gmail" ? "Gmail" : "Microsoft 365"}.`);
      refresh();
    } else if (oauthError) {
      setBanner(`Connection failed: ${oauthError.replace(/_/g, " ")}.`);
    }
    if (connected || oauthError) {
      window.history.replaceState({}, "", window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startOAuth(provider: ProviderInfo) {
    if (!pid) return;
    setError(null);
    try {
      const { url } = await apiFetch<{ url: string }>(`/v1/projects/${pid}/connections/oauth/${provider.id}/start`, {
        method: "POST",
      });
      window.location.href = url;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't start OAuth flow");
    }
  }

  async function createConnection() {
    if (!pid || !adding) return;
    setError(null);
    try {
      await apiFetch(`/v1/projects/${pid}/connections`, {
        method: "POST",
        body: JSON.stringify({ kind: adding.kind, provider: adding.id, credentials }),
      });
      setAdding(null);
      setCredentials({});
      await refresh();
    } catch (e) {
      setError(e instanceof ApiError && e.status === 403 ? "You need admin access to connect providers." : e instanceof Error ? e.message : "Couldn't connect");
    }
  }

  async function testConnection(conn: ConnectionRow) {
    if (!pid) return;
    setBusyId(conn.id);
    setError(null);
    try {
      await apiFetch(`/v1/projects/${pid}/connections/${conn.id}/test`, { method: "POST" });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Test failed");
    } finally {
      setBusyId(null);
    }
  }

  async function disconnect(conn: ConnectionRow) {
    if (!pid) return;
    if (!confirm(`Disconnect ${providerInfo(conn.provider)?.label ?? conn.provider}?`)) return;
    setBusyId(conn.id);
    setError(null);
    try {
      await apiFetch(`/v1/projects/${pid}/connections/${conn.id}`, { method: "DELETE" });
      await refresh();
    } catch (e) {
      setError(e instanceof ApiError && e.status === 403 ? "You need admin access to disconnect providers." : "Couldn't disconnect");
    } finally {
      setBusyId(null);
    }
  }

  const emailConns = connections.filter((c) => c.kind === "email");
  const waConns = connections.filter((c) => c.kind === "whatsapp");

  function section(kind: "email" | "whatsapp", title: string, conns: ConnectionRow[]) {
    return (
      <section className="panel">
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
          <h2>{title}</h2>
        </div>
        {conns.length ? (
          <div className="tbl-wrap" style={{ marginBottom: 14 }}>
            <table>
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Account</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {conns.map((c) => (
                  <tr key={c.id}>
                    <td>{providerInfo(c.provider)?.label ?? c.provider}</td>
                    <td className="small muted">{c.account_label || "—"}</td>
                    <td>
                      <span className={`pill ${STATUS_TONE[c.status]}`} title={c.needs_reconnect_reason ?? undefined}>
                        <span className="dot" />
                        {STATUS_LABEL[c.status]}
                      </span>
                    </td>
                    <td>
                      <div className="row">
                        <button className="btn small" disabled={busyId === c.id} onClick={() => testConnection(c)}>
                          Test
                        </button>
                        <button className="btn small danger" disabled={busyId === c.id} onClick={() => disconnect(c)}>
                          Disconnect
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted small" style={{ marginBottom: 14 }}>
            No {title.toLowerCase()} providers connected yet.
          </p>
        )}
        <div className="grid g3">
          {PROVIDERS.filter((p) => p.kind === kind).map((p) => (
            <div
              key={p.id}
              className="provider"
              role="button"
              tabIndex={0}
              onClick={() => (p.auth === "oauth" ? startOAuth(p) : (setAdding(p), setCredentials({})))}
            >
              <b className="small">{p.label}</b>
              <span aria-hidden="true">{p.auth === "oauth" ? "→" : "+"}</span>
            </div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <>
      <div className="top">
        <div>
          <h1>Email &amp; WhatsApp</h1>
          <p>Connect sender accounts. Credentials are encrypted at rest and never sent back to the browser.</p>
        </div>
      </div>
      {banner && (
        <div className="banner" style={{ cursor: "pointer" }} onClick={() => setBanner(null)}>
          {banner}
        </div>
      )}
      {error && (
        <p className="small" style={{ color: "var(--bad)", marginBottom: 12 }}>
          {error}
        </p>
      )}
      {loading ? (
        <p className="muted small">Loading connections…</p>
      ) : (
        <div className="grid g2">
          {section("email", "Email", emailConns)}
          {section("whatsapp", "WhatsApp", waConns)}
        </div>
      )}

      {adding && (
        <div className="scrim open" onClick={() => setAdding(null)}>
          <div className="drawer open" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <header>
              <h2>Connect {adding.label}</h2>
              <button className="btn small" onClick={() => setAdding(null)} aria-label="Close">
                ✕
              </button>
            </header>
            <div className="body">
              {adding.fields.map((f) => (
                <div key={f.key} className="field">
                  <label htmlFor={`f_${f.key}`}>{f.label}</label>
                  <input
                    id={`f_${f.key}`}
                    type={f.type === "password" ? "password" : "text"}
                    placeholder={f.placeholder}
                    value={credentials[f.key] ?? ""}
                    onChange={(e) => setCredentials({ ...credentials, [f.key]: e.target.value })}
                  />
                </div>
              ))}
            </div>
            <div className="foot">
              <button className="btn" onClick={() => setAdding(null)}>
                Cancel
              </button>
              <button className="btn primary" onClick={createConnection}>
                Connect &amp; test
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
