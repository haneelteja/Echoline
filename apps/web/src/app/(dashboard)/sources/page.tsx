"use client";
import { useWorkspace } from "@/components/WorkspaceProvider";

export default function SourcesPage() {
  const { sources } = useWorkspace();
  return (
    <>
      <div className="top">
        <div>
          <h1>Lead sources</h1>
          <p>Scheduled sync (OneDrive, Sheets, CRMs, webhooks, forms) ships in Phase 5.</p>
        </div>
      </div>
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
