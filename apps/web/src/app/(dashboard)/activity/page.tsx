"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Eye,
  Loader2,
  Mail,
  MessageCircle,
  Search,
  X,
  XCircle,
} from "lucide-react";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { apiFetch } from "@/lib/apiClient";
import { createClient } from "@/lib/supabase/client";
import type { MessageEventRow } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ColumnFilter, SortIndicator, type SortDirection } from "@/components/ui/column-filter";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const EVENT_TONE: Record<string, "ok" | "e" | "warn" | "bad"> = {
  sent: "ok",
  delivered: "ok",
  opened: "e",
  clicked: "e",
  read: "e",
  replied: "ok",
  bounced: "bad",
  failed: "bad",
  blocked: "warn",
  invalid: "warn",
  opted_out: "warn",
  complained: "bad",
  dropped: "bad",
  dead_letter: "bad",
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
  dead_letter: "Gave up — needs review",
};

function eventLabel(eventType: string): string {
  return EVENT_LABEL[eventType] ?? eventType;
}

function eventSummary(ev: MessageEventRow): string | null {
  const p = ev.payload;
  if (!p) return null;
  if (typeof p.reason === "string") return p.reason;
  if (typeof p.body === "string") return `"${p.body}"`;
  if (typeof p.url === "string") return p.url;
  if (typeof p.error === "string") return p.error;
  return null;
}

const TONE_CLASSNAME: Record<"ok" | "e" | "warn" | "bad", string> = {
  ok: "border-transparent bg-success/15 text-success",
  e: "border-transparent bg-sky-500/15 text-sky-700",
  warn: "border-transparent bg-amber-500/15 text-amber-700",
  bad: "border-transparent bg-destructive/15 text-destructive",
};

const TONE_ICON: Record<"ok" | "e" | "warn" | "bad", typeof CheckCircle2> = {
  ok: CheckCircle2,
  e: Eye,
  warn: AlertTriangle,
  bad: XCircle,
};

function EventBadge({ eventType }: { eventType: string }) {
  const tone = EVENT_TONE[eventType] ?? "e";
  const Icon = TONE_ICON[tone];
  return (
    <Badge className={cn("gap-1 font-semibold", TONE_CLASSNAME[tone])}>
      <Icon className="h-3 w-3" />
      {eventLabel(eventType)}
    </Badge>
  );
}

function ChannelBadge({ channel }: { channel: "em" | "wa" | null }) {
  if (channel === "em") {
    return (
      <Badge className="gap-1 border-transparent bg-sky-500/15 font-semibold text-sky-700">
        <Mail className="h-3 w-3" />
        Email
      </Badge>
    );
  }
  if (channel === "wa") {
    return (
      <Badge className="gap-1 border-transparent bg-teal-500/15 font-semibold text-teal-700">
        <MessageCircle className="h-3 w-3" />
        WhatsApp
      </Badge>
    );
  }
  return <span className="text-muted-foreground">—</span>;
}

type ColumnKey = "occurred_at" | "channel" | "contact" | "event_type" | "detail";
const EMPTY_FILTERS: Record<ColumnKey, string> = { occurred_at: "", channel: "", contact: "", event_type: "", detail: "" };

function sortValue(ev: MessageEventRow, key: ColumnKey): string {
  if (key === "occurred_at") return ev.occurred_at;
  if (key === "channel") return ev.channel === "em" ? "Email" : ev.channel === "wa" ? "WhatsApp" : "";
  if (key === "contact") return ev.contacts?.name ?? "";
  if (key === "event_type") return eventLabel(ev.event_type);
  return eventSummary(ev) ?? "";
}

/** Same reasoning as contacts/page.tsx's ColumnHead — defined at module scope
 * so it isn't re-created (and its dropdown re-mounted) on every render. */
function ColumnHead({
  columnKey,
  label,
  dataType,
  options,
  sort,
  filterValue,
  onFilterChange,
  onSortChange,
}: {
  columnKey: ColumnKey;
  label: string;
  dataType?: "text" | "select";
  options?: string[];
  sort: { key: ColumnKey; dir: "asc" | "desc" }[];
  filterValue: string;
  onFilterChange: (key: ColumnKey, value: string) => void;
  onSortChange: (key: ColumnKey, dir: SortDirection) => void;
}) {
  const index = sort.findIndex((s) => s.key === columnKey);
  const dir = index >= 0 ? sort[index].dir : null;
  return (
    <TableHead>
      <div className="flex items-center gap-1">
        <span>{label}</span>
        <SortIndicator direction={dir} priority={index >= 0 ? index + 1 : undefined} />
        <ColumnFilter
          label={label}
          dataType={dataType}
          options={options}
          filterValue={filterValue}
          onFilterChange={(v) => onFilterChange(columnKey, v)}
          sortDirection={dir}
          onSortChange={(d) => onSortChange(columnKey, d)}
        />
      </div>
    </TableHead>
  );
}

export default function ActivityPage() {
  const { pid } = useWorkspace();
  const supabase = useMemo(() => createClient(), []);
  const [events, setEvents] = useState<MessageEventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const [search, setSearch] = useState("");
  const [columnFilters, setColumnFilters] = useState<Record<ColumnKey, string>>(EMPTY_FILTERS);
  const [sort, setSort] = useState<{ key: ColumnKey; dir: "asc" | "desc" }[]>([{ key: "occurred_at", dir: "desc" }]);

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

  const eventOptions = useMemo(() => Array.from(new Set(events.map((ev) => eventLabel(ev.event_type)))).sort(), [events]);
  const channelOptions = useMemo(() => {
    const opts = new Set<string>();
    for (const ev of events) if (ev.channel === "em") opts.add("Email"); else if (ev.channel === "wa") opts.add("WhatsApp");
    return Array.from(opts).sort();
  }, [events]);

  function setColumnFilter(key: ColumnKey, value: string) {
    setColumnFilters((f) => ({ ...f, [key]: value }));
  }

  function setColumnSort(key: ColumnKey, dir: SortDirection) {
    setSort((cur) => {
      if (!dir) return cur.filter((s) => s.key !== key);
      const existing = cur.findIndex((s) => s.key === key);
      if (existing >= 0) return cur.map((s, i) => (i === existing ? { key, dir } : s));
      return [...cur, { key, dir }];
    });
  }

  const hasActiveFilters = Boolean(search) || Object.values(columnFilters).some(Boolean) || sort.length > 0;

  function clearFilters() {
    setSearch("");
    setColumnFilters(EMPTY_FILTERS);
    setSort([{ key: "occurred_at", dir: "desc" }]);
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = events.filter((ev) => {
      if (columnFilters.channel) {
        const label = ev.channel === "em" ? "Email" : ev.channel === "wa" ? "WhatsApp" : "";
        if (label !== columnFilters.channel) return false;
      }
      if (columnFilters.contact && !(ev.contacts?.name ?? "").toLowerCase().includes(columnFilters.contact.toLowerCase())) return false;
      if (columnFilters.event_type && eventLabel(ev.event_type) !== columnFilters.event_type) return false;
      if (columnFilters.detail && !(eventSummary(ev) ?? "").toLowerCase().includes(columnFilters.detail.toLowerCase())) return false;
      if (!q) return true;
      return (
        (ev.contacts?.name ?? "").toLowerCase().includes(q) ||
        eventLabel(ev.event_type).toLowerCase().includes(q) ||
        (eventSummary(ev) ?? "").toLowerCase().includes(q)
      );
    });
    if (sort.length) {
      rows = [...rows].sort((a, b) => {
        for (const { key, dir } of sort) {
          const cmp = sortValue(a, key).localeCompare(sortValue(b, key));
          if (cmp !== 0) return dir === "asc" ? cmp : -cmp;
        }
        return 0;
      });
    }
    return rows;
  }, [events, search, columnFilters, sort]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-foreground">Activity log</h1>
        <p className="text-sm text-muted-foreground">Sends, opens, clicks, deliveries, bounces and replies for this project, newest first.</p>
      </div>

      {!loading && events.length > 0 && (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3 shadow-sm sm:flex-row sm:items-center">
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Search contact, event, detail…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
          </div>
          <Button variant="outline" size="sm" className="rounded-full" onClick={clearFilters} disabled={!hasActiveFilters}>
            <X className="h-3.5 w-3.5" />
            Clear filters
          </Button>
          <p className="text-xs text-muted-foreground sm:ml-auto sm:text-right">
            {filtered.length} of {events.length} events — use the ⋮ menu on a column to sort or filter it.
          </p>
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center gap-2 py-24 text-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading activity…</p>
        </div>
      ) : events.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              <ColumnHead columnKey="occurred_at" label="When" sort={sort} filterValue={columnFilters.occurred_at} onFilterChange={setColumnFilter} onSortChange={setColumnSort} />
              <ColumnHead
                columnKey="channel"
                label="Channel"
                dataType="select"
                options={channelOptions}
                sort={sort}
                filterValue={columnFilters.channel}
                onFilterChange={setColumnFilter}
                onSortChange={setColumnSort}
              />
              <ColumnHead columnKey="contact" label="Contact" sort={sort} filterValue={columnFilters.contact} onFilterChange={setColumnFilter} onSortChange={setColumnSort} />
              <ColumnHead
                columnKey="event_type"
                label="Event"
                dataType="select"
                options={eventOptions}
                sort={sort}
                filterValue={columnFilters.event_type}
                onFilterChange={setColumnFilter}
                onSortChange={setColumnSort}
              />
              <ColumnHead columnKey="detail" label="Detail" sort={sort} filterValue={columnFilters.detail} onFilterChange={setColumnFilter} onSortChange={setColumnSort} />
            </TableRow>
          </TableHeader>
          <TableBody className="[&>tr:nth-child(even)]:bg-muted/30">
            {filtered.map((ev) => (
              <TableRow key={ev.id}>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <Clock className="h-3 w-3 shrink-0 opacity-50" />
                    {new Date(ev.occurred_at).toLocaleString()}
                  </span>
                </TableCell>
                <TableCell>
                  <ChannelBadge channel={ev.channel} />
                </TableCell>
                <TableCell className="font-medium text-foreground">{ev.contacts?.name ?? "—"}</TableCell>
                <TableCell>
                  <EventBadge eventType={ev.event_type} />
                </TableCell>
                <TableCell className="max-w-[320px] truncate text-muted-foreground" title={eventSummary(ev) ?? undefined}>
                  {eventSummary(ev) ?? "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <Card>
          <CardHeader className="items-center gap-2 text-center">
            <h2 className="font-display text-lg font-semibold text-foreground">Nothing logged yet</h2>
            <p className="text-sm text-muted-foreground">Sends, opens, clicks, deliveries, bounces and replies will show up here as they happen.</p>
          </CardHeader>
        </Card>
      )}

      {!filtered.length && events.length > 0 && (
        <p className="text-center text-sm text-muted-foreground">No events match your filters.</p>
      )}

      {hasMore && events.length > 0 && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
            {loadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}
    </div>
  );
}
