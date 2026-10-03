"use client";
import { useState } from "react";
import { statusLabel } from "@echoline/core";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { apiFetch, ApiError } from "@/lib/apiClient";

export default function ContactsPage() {
  const { pid, contacts, refreshProjectData } = useWorkspace();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function addLead() {
    if (!pid || !name.trim()) return;
    setError(null);
    try {
      await apiFetch(`/v1/projects/${pid}/contacts`, {
        method: "POST",
        body: JSON.stringify({ name, email, phone, em_status: "not_contacted", wa_status: "not_contacted" }),
      });
      setName("");
      setEmail("");
      setPhone("");
      setAdding(false);
      await refreshProjectData();
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        setError("You have view-only access and can't add leads.");
      } else {
        setError(e instanceof Error ? e.message : "Couldn't add lead");
      }
    }
  }

  return (
    <>
      <div className="top">
        <div>
          <h1>Leads &amp; status</h1>
          <p>{contacts.length} leads</p>
        </div>
        <div className="row">
          <button className="btn primary" onClick={() => setAdding((v) => !v)}>
            Add lead
          </button>
        </div>
      </div>

      {adding && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="grid g3">
            <div className="field">
              <label htmlFor="n">Business name</label>
              <input id="n" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="e">Email</label>
              <input id="e" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="p">Phone</label>
              <input id="p" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>
          <button className="btn primary" onClick={addLead} disabled={!name.trim()}>
            Save lead
          </button>
          {error && (
            <p className="small" style={{ color: "var(--bad)", marginTop: 10 }}>
              {error}
            </p>
          )}
        </div>
      )}

      {contacts.length ? (
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>Business</th>
                <th>Category</th>
                <th>Area</th>
                <th>Email status</th>
                <th>WhatsApp status</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.id}>
                  <td>
                    <b>{c.name}</b>
                  </td>
                  <td>{c.category || "—"}</td>
                  <td>{c.area || "—"}</td>
                  <td>
                    <span className="pill e">{statusLabel(c.em_status)}</span>
                  </td>
                  <td>
                    <span className="pill w">{statusLabel(c.wa_status)}</span>
                  </td>
                  <td className="small muted">{c.source || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty panel">
          <h2>No leads in this project</h2>
          <p>
            Add a lead by hand, or connect a <a href="/sources">webhook or website form</a> to import automatically.
          </p>
        </div>
      )}
    </>
  );
}
