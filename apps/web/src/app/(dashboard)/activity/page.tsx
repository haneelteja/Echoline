"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { apiFetch } from "@/lib/apiClient";
import { createClient } from "@/lib/supabase/client";
import type { MessageEventRow } from "@/lib/types";

const EVENT_TONE: Record<string, string> = {
  sent: "ok",
  delivered: "ok",
  opened: "e",
  clicked: "e",
  read: "w",
  replied: "ok",
  bounced: "bad",
  failed: "bad",
  blocked: "warn",
  invalid: "warn",
  opted_out: "warn",
  complained: "bad",
  dropped: "bad",
};

const EVENT_LABEL: Record<string, string> = {
  sent: "Sent",
  delivered: "Delivered",
  opened: "Opened",
  clicked: "Clicked",
  read: "Read",
  replied: "Replied",
  bounced: "Bounced",
  failed: "Failed",
  blocked: "Blocked",
  invalid: "Invalid",
  opted_out: "Opted out",
  complained: "Marked as spam",
  dropped: "Dropped",
};

function eventSummary(ev: MessageEventRow): string | null {
  const p = ev.payload;
  if (!p) return null;
  if (typeof p.reason === "string") return p.reason;
  if (typeof p.body === "string") return `"${p.body}"`;
  if (typeof p.url === "string") return p.url;
  if (typeof p.error === "string") return p.error;
  return null;
}

export default function ActivityPage() {
  const { pid } = useWorkspace();
  const supabase = useMemo(() => createClient(), []);
  const [events, setEvents] = useState<MessageEventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const load = useCallback(async () => {
    if (!pid) return;
    setLoading(true);
    try {
      const data = await apiFetch<MessageEventRow[]>(`/v1/projects/${pid}/activity`);
      setEvents(data);
      setHasMore(data.length === 100);
    } finally {
      setLoading(false);
    }
  }, [pid]);

  async function loadMore() {
    if (!pid || !events.length) return;
    setLoadingMore(true);
    try {
      const before = events[events.length - 1].occurred_at;
      const more = await apiFetch<MessageEventRow[]>(`/v1/projects/${pid}/activity?before=${encodeURIComponent(before)}`);
      setEvents((cur) => [...cur, ...more]);
      setHasMore(more.length === 100);
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    load();
  }, [load]);

  // New events prepend live rather than waiting for a manual refresh — same
  // "subscribe, then refetch that slice" pattern WorkspaceProvider uses for
  // everything else, kept separate here since message_events is high-volume
  // and append-only, unlike the config/state tables that pattern covers.
  useEffect(() => {
    if (!pid) return;
    const channel = supabase
      .channel(`activity:${pid}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "message_events", filter: `project_id=eq.${pid}` }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [pid, supabase, load]);

  return (
    <>
      <div className="top">
        <div>
          <h1>Activity log</h1>
          <p>Sends, opens, clicks, deliveries, bounces and replies for this project, newest first.</p>
        </div>
      </div>

      {loading ? (
        <p className="muted small">Loading…</p>
      ) : events.length ? (
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Channel</th>
                <th>Contact</th>
                <th>Event</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {events.map((ev) => (
                <tr key={ev.id}>
                  <td className="small muted">{new Date(ev.occurred_at).toLocaleString()}</td>
                  <td>{ev.channel === "em" ? <span className="pill e">Email</span> : ev.channel === "wa" ? <span className="pill w">WhatsApp</span> : "—"}</td>
                  <td>{ev.contacts?.name ?? "—"}</td>
                  <td>
                    <span className={`pill ${EVENT_TONE[ev.event_type] ?? ""}`}>
                      <span className="dot" />
                      {EVENT_LABEL[ev.event_type] ?? ev.event_type}
                    </span>
                  </td>
                  <td className="small muted">{eventSummary(ev) ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty panel">
          <h2>Nothing logged yet</h2>
          <p>Sends, opens, clicks, deliveries, bounces and replies will show up here as they happen.</p>
        </div>
      )}

      {hasMore && events.length > 0 && (
        <div className="row" style={{ justifyContent: "center", marginTop: 14 }}>
          <button className="btn" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </>
  );
}
