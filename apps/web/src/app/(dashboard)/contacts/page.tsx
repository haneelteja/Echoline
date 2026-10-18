"use client";
import { useMemo, useState, type ComponentType } from "react";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Database,
  FileSpreadsheet,
  Hand,
  Loader2,
  Mail,
  MapPin,
  MessageCircle,
  MessagesSquare,
  Plus,
  Search,
  Send,
  Upload,
  Users,
  X,
  XCircle,
} from "lucide-react";
import { normPhone, SENTIMENT_VALUES, statusLabel, validEmail, type ContactChannelStatus } from "@echoline/core";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { apiFetch, ApiError } from "@/lib/apiClient";
import type { ContactRow } from "@/lib/types";
import { ImportLeadsDialog } from "@/components/ImportLeadsDialog";
import { StatusLogDialog } from "@/components/StatusLogDialog";
import { SendNowDialog } from "@/components/SendNowDialog";
import { SentimentPicker } from "@/components/SentimentPicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { KpiCard } from "@/components/ui/kpi-card";
import { ColumnFilter, SortIndicator, type SortDirection } from "@/components/ui/column-filter";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

const TERMINAL_GOOD: ContactChannelStatus[] = ["completed", "replied"];
const TERMINAL_BAD: ContactChannelStatus[] = ["opted_out", "invalid_email", "invalid_whatsapp", "bounced", "failed"];

function statusVariant(status: ContactChannelStatus): "success" | "destructive" | "secondary" | "default" {
  if (TERMINAL_GOOD.includes(status)) return "success";
  if (TERMINAL_BAD.includes(status)) return "destructive";
  if (status === "not_contacted") return "secondary";
  return "default";
}

function statusIcon(status: ContactChannelStatus) {
  if (TERMINAL_GOOD.includes(status)) return CheckCircle2;
  if (TERMINAL_BAD.includes(status)) return XCircle;
  if (status === "not_contacted") return Clock;
  return Send;
}

/** Status badge with an icon that echoes its color bucket — lets the eye
 * scan a long column for "stuck"/"failed" rows without reading every label.
 * `manual` shows a small "Manually sent" chip next to it when the most
 * recent send for this channel was a one-off "Send now" rather than the
 * automated sequence — they now advance stage/status identically, so this
 * is purely informational, not a different status. */
function StatusBadge({ status, manual }: { status: ContactChannelStatus; manual?: boolean }) {
  const Icon = statusIcon(status);
  return (
    <div className="flex items-center gap-1.5">
      <Badge variant={statusVariant(status)} className="gap-1 font-semibold">
        <Icon className="h-3 w-3" />
        {statusLabel(status)}
      </Badge>
      {manual && (
        <Badge variant="outline" className="gap-1 text-muted-foreground" title="Most recently sent manually, via Send now">
          <Hand className="h-3 w-3" />
          Manual
        </Badge>
      )}
    </div>
  );
}

// Deterministic per-business color + initials, purely a scanning aid for a
// long list of otherwise-identical rows — same name always gets the same
// color/letters, no state or randomness involved.
const AVATAR_PALETTE = [
  { bg: "bg-purple-100", text: "text-purple-700" },
  { bg: "bg-sky-100", text: "text-sky-700" },
  { bg: "bg-teal-100", text: "text-teal-700" },
  { bg: "bg-amber-100", text: "text-amber-700" },
  { bg: "bg-rose-100", text: "text-rose-700" },
  { bg: "bg-emerald-100", text: "text-emerald-700" },
  { bg: "bg-indigo-100", text: "text-indigo-700" },
  { bg: "bg-violet-100", text: "text-violet-700" },
] as const;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function BusinessAvatar({ name }: { name: string }) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  const p = AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
  return (
    <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold", p.bg, p.text)}>
      {initials(name)}
    </span>
  );
}

type ColumnKey = "name" | "area" | "em_status" | "wa_status" | "sentiment";

const EMPTY_FILTERS: Record<ColumnKey, string> = { name: "", area: "", em_status: "", wa_status: "", sentiment: "" };

// "all" isn't a real ContactChannelStatus — it means "don't filter by stage".
// completed/replied/opted_out/bounced/failed leads only show up under "All",
// same as before; the first 4 tabs cover the sequence-progress states a lead
// walks through on its way there. "invalid" is its own tab (mapped to
// invalid_email/invalid_whatsapp depending on which channel's StageTabs this
// is) so a stuck-on-bad-contact-info lead can be isolated instead of only
// ever showing up buried in "All" on the Database tab.
type StageTab = "all" | "not_contacted" | "initial_sent" | "fu1_sent" | "fu2_sent" | "invalid";
const STAGE_TABS: { key: StageTab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "not_contacted", label: "Not contacted" },
  { key: "initial_sent", label: "Initial" },
  { key: "fu1_sent", label: "Follow-up 1" },
  { key: "fu2_sent", label: "Follow-up 2" },
  { key: "invalid", label: "Invalid" },
];

function StageTabs({
  label,
  accent,
  value,
  onChange,
  counts,
}: {
  label: string;
  accent: "sky" | "teal";
  value: StageTab;
  onChange: (v: StageTab) => void;
  counts: Record<StageTab, number>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span
        className={cn(
          "text-xs font-semibold uppercase tracking-wide",
          accent === "sky" ? "text-sky-700" : "text-teal-700"
        )}
      >
        {label}
      </span>
      <div className="flex flex-wrap gap-1">
        {STAGE_TABS.map((t) => {
          const isInvalid = t.key === "invalid";
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => onChange(t.key)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors",
                value === t.key
                  ? isInvalid
                    ? "bg-rose-600 text-white"
                    : accent === "sky"
                      ? "bg-sky-600 text-white"
                      : "bg-teal-600 text-white"
                  : isInvalid
                    ? "bg-rose-50 text-rose-700 hover:bg-rose-100"
                    : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              {t.label}
              <span
                className={cn(
                  "rounded-full px-1.5 text-[10px] font-semibold tabular-nums",
                  value === t.key ? "bg-white/20" : isInvalid ? "bg-rose-100 text-rose-700" : "bg-background text-muted-foreground"
                )}
              >
                {counts[t.key]}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const VIEW_TABS = [
  { key: "database", label: "Database", icon: Database },
  { key: "email", label: "Email status", icon: Mail },
  { key: "whatsapp", label: "WhatsApp status", icon: MessageCircle },
] as const;
type ViewTab = (typeof VIEW_TABS)[number]["key"];

function ViewTabs({ value, onChange }: { value: ViewTab; onChange: (v: ViewTab) => void }) {
  return (
    <div className="flex gap-1 border-b border-border">
      {VIEW_TABS.map((t) => {
        const Icon = t.icon;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            className={cn(
              "-mb-px inline-flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
              value === t.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="h-4 w-4" />
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

function sortValue(c: ContactRow, key: ColumnKey): string {
  if (key === "em_status") return statusLabel(c.em_status);
  if (key === "wa_status") return statusLabel(c.wa_status);
  if (key === "area") return c.area ?? "";
  if (key === "sentiment") return c.sentiment;
  return c.name;
}

/** Defined at module scope deliberately — defining this inside ContactsPage's
 * render body would make React treat it as a brand-new component type on
 * every render (every keystroke, every realtime contacts update), forcing a
 * full unmount+remount of every column's dropdown on each render. That's
 * exactly the kind of thing that makes a Radix dropdown's click handler miss
 * — the DOM node it was attached to gets torn down mid-interaction. */
function ColumnHead({
  columnKey,
  label,
  icon: Icon,
  iconClassName,
  dataType,
  options,
  sort,
  filterValue,
  onFilterChange,
  onSortChange,
}: {
  columnKey: ColumnKey;
  label: string;
  icon?: ComponentType<{ className?: string }>;
  iconClassName?: string;
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
        {Icon && <Icon className={cn("h-3.5 w-3.5", iconClassName)} />}
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

export default function ContactsPage() {
  const { pid, contacts, templates, statusLog, loadingProject, refreshProjectData } = useWorkspace();
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<ViewTab>("database");
  const [search, setSearch] = useState("");
  const [columnFilters, setColumnFilters] = useState<Record<ColumnKey, string>>(EMPTY_FILTERS);
  // Ordered list, not a single value — the order entries appear in is the
  // sort priority (first = primary sort, rest = tie-breakers in order).
  const [sort, setSort] = useState<{ key: ColumnKey; dir: "asc" | "desc" }[]>([]);
  const [emStageTab, setEmStageTabState] = useState<StageTab>("all");
  const [waStageTab, setWaStageTabState] = useState<StageTab>("all");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;

  function setEmStageTab(v: StageTab) {
    setEmStageTabState(v);
    setPage(1);
  }
  function setWaStageTab(v: StageTab) {
    setWaStageTabState(v);
    setPage(1);
  }

  const [statusLogContact, setStatusLogContact] = useState<ContactRow | null>(null);
  const [sendNow, setSendNow] = useState<{ contact: ContactRow; channel: "email" | "whatsapp" } | null>(null);

  const kpis = useMemo(() => {
    const total = contacts.length;
    const emailSent = contacts.filter((c) => c.em_stage > 0).length;
    const waSent = contacts.filter((c) => c.wa_stage > 0).length;
    const emailReplied = contacts.filter((c) => c.em_status === "replied").length;
    const waReplied = contacts.filter((c) => c.wa_status === "replied").length;
    const replied = contacts.filter((c) => c.em_status === "replied" || c.wa_status === "replied").length;
    return { total, emailSent, waSent, emailReplied, waReplied, replied };
  }, [contacts]);

  const emStatusOptions = useMemo(() => Array.from(new Set(contacts.map((c) => statusLabel(c.em_status)))).sort(), [contacts]);
  const waStatusOptions = useMemo(() => Array.from(new Set(contacts.map((c) => statusLabel(c.wa_status)))).sort(), [contacts]);

  // Per-stage counts shown as little badges on the StageTabs pills — the
  // sequence-progress states plus "invalid" get their own count; the
  // remaining terminal statuses (completed/replied/opted_out/bounced/failed)
  // all collapse into "All", same as the filter logic below.
  const emStageCounts = useMemo(() => {
    const counts: Record<StageTab, number> = { all: contacts.length, not_contacted: 0, initial_sent: 0, fu1_sent: 0, fu2_sent: 0, invalid: 0 };
    for (const c of contacts) {
      if (c.em_status === "invalid_email") counts.invalid++;
      else if (c.em_status in counts) counts[c.em_status as StageTab]++;
    }
    return counts;
  }, [contacts]);
  const waStageCounts = useMemo(() => {
    const counts: Record<StageTab, number> = { all: contacts.length, not_contacted: 0, initial_sent: 0, fu1_sent: 0, fu2_sent: 0, invalid: 0 };
    for (const c of contacts) {
      if (c.wa_status === "invalid_whatsapp") counts.invalid++;
      else if (c.wa_status in counts) counts[c.wa_status as StageTab]++;
    }
    return counts;
  }, [contacts]);

  const latestStatusByContact = useMemo(() => {
    const map = new Map<string, (typeof statusLog)[number]>();
    for (const entry of statusLog) {
      if (!map.has(entry.contact_id)) map.set(entry.contact_id, entry);
    }
    return map;
  }, [statusLog]);

  function setColumnFilter(key: ColumnKey, value: string) {
    setColumnFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  }

  // A column clicked for the first time is appended as the new lowest-priority
  // tie-breaker; toggling an already-sorted column's direction updates it in
  // place without changing its priority. Matches "first sort by X, then by Y"
  // phrasing directly: click X's sort, then click Y's sort.
  function setColumnSort(key: ColumnKey, dir: SortDirection) {
    setSort((cur) => {
      if (!dir) return cur.filter((s) => s.key !== key);
      const existing = cur.findIndex((s) => s.key === key);
      if (existing >= 0) return cur.map((s, i) => (i === existing ? { key, dir } : s));
      return [...cur, { key, dir }];
    });
    setPage(1);
  }

  function onSearchChange(value: string) {
    setSearch(value);
    setPage(1);
  }

  const hasActiveFilters =
    Boolean(search) || Object.values(columnFilters).some(Boolean) || sort.length > 0 || emStageTab !== "all" || waStageTab !== "all";

  function clearFilters() {
    setSearch("");
    setColumnFilters(EMPTY_FILTERS);
    setSort([]);
    setEmStageTabState("all");
    setWaStageTabState("all");
    setPage(1);
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = contacts.filter((c) => {
      if (columnFilters.name && !c.name.toLowerCase().includes(columnFilters.name.toLowerCase())) return false;
      if (columnFilters.area && !(c.area ?? "").toLowerCase().includes(columnFilters.area.toLowerCase())) return false;
      if (columnFilters.em_status && statusLabel(c.em_status) !== columnFilters.em_status) return false;
      if (columnFilters.wa_status && statusLabel(c.wa_status) !== columnFilters.wa_status) return false;
      if (columnFilters.sentiment && c.sentiment !== columnFilters.sentiment) return false;
      // "invalid" isn't a literal ContactChannelStatus — it maps to
      // invalid_email/invalid_whatsapp depending on which channel's tab this is.
      if (emStageTab === "invalid") {
        if (c.em_status !== "invalid_email") return false;
      } else if (emStageTab !== "all" && c.em_status !== emStageTab) return false;
      if (waStageTab === "invalid") {
        if (c.wa_status !== "invalid_whatsapp") return false;
      } else if (waStageTab !== "all" && c.wa_status !== waStageTab) return false;
      // The Email/WhatsApp status tabs default to leads that channel can
      // actually be sent to — invalid email/number is clutter under "All",
      // not useful signal. Selecting the "Invalid" stage tab explicitly
      // overrides this. The Database tab always shows everything.
      if (activeTab === "email" && emStageTab === "all" && c.em_status === "invalid_email") return false;
      if (activeTab === "whatsapp" && waStageTab === "all" && c.wa_status === "invalid_whatsapp") return false;
      if (!q) return true;
      return c.name.toLowerCase().includes(q) || (c.email ?? "").toLowerCase().includes(q) || (c.phone ?? "").toLowerCase().includes(q);
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
  }, [contacts, search, columnFilters, sort, emStageTab, waStageTab, activeTab]);

  // Pagination keeps the table from ever mounting hundreds of fully-interactive
  // rows (each with a native <select>, two icon buttons, two badges) in one
  // React commit — with 800+ leads that was enough synchronous DOM work on
  // initial render to trip the browser's own "Page Unresponsive" freeze
  // warning, independent of any app-level bug.
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageItems = useMemo(() => filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE), [filtered, currentPage]);

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
      // Realtime picks up the new contacts row — see updateSentiment's comment.
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        setError("You have view-only access and can't add leads.");
      } else {
        setError(e instanceof Error ? e.message : "Couldn't add lead");
      }
    }
  }

  async function updateSentiment(contactId: string, sentiment: string) {
    if (!pid) return;
    setError(null);
    try {
      // No manual refetch needed — WorkspaceProvider's realtime subscription
      // already refreshes `contacts` the moment this UPDATE lands, so a
      // redundant full 8-endpoint refreshProjectData() would just be wasted
      // work on every single sentiment edit.
      await apiFetch(`/v1/projects/${pid}/contacts/${contactId}`, { method: "PATCH", body: JSON.stringify({ sentiment }) });
    } catch (e) {
      setError(e instanceof ApiError && e.status === 403 ? "You have view-only access and can't change sentiment." : "Couldn't update sentiment.");
    }
  }

  // contacts defaults to [] before the first fetch completes, which looks
  // identical to a genuinely empty project — loadingProject disambiguates
  // "still loading" from "actually zero leads" (same pattern as dashboard/page.tsx).
  if (loadingProject && contacts.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-24 text-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Loading leads…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1.5">
          <h1 className="font-display text-2xl font-bold text-foreground">Leads &amp; status</h1>
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            {filtered.length} of {contacts.length} leads
          </span>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setImporting(true)}>
            <Upload className="h-4 w-4" />
            Import Excel
          </Button>
          <Button onClick={() => setAdding((v) => !v)}>
            <Plus className="h-4 w-4" />
            Add lead
          </Button>
        </div>
      </div>

      {activeTab === "database" && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <KpiCard label="Total leads" value={kpis.total} icon={Users} accent="purple" />
          <KpiCard label="Email sent" value={kpis.emailSent} sub={`of ${kpis.total}`} icon={Mail} accent="sky" />
          <KpiCard label="WhatsApp sent" value={kpis.waSent} sub={`of ${kpis.total}`} icon={MessageCircle} accent="teal" />
          <KpiCard label="Replied" value={kpis.replied} sub="across both channels" icon={MessagesSquare} accent="emerald" />
        </div>
      )}
      {activeTab === "email" && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <KpiCard label="Total leads" value={kpis.total} icon={Users} accent="purple" />
          <KpiCard label="Email sent" value={kpis.emailSent} sub={`of ${kpis.total}`} icon={Mail} accent="sky" />
          <KpiCard label="Replied" value={kpis.emailReplied} sub={`of ${kpis.emailSent} sent`} icon={MessagesSquare} accent="emerald" />
        </div>
      )}
      {activeTab === "whatsapp" && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <KpiCard label="Total leads" value={kpis.total} icon={Users} accent="purple" />
          <KpiCard label="WhatsApp sent" value={kpis.waSent} sub={`of ${kpis.total}`} icon={MessageCircle} accent="teal" />
          <KpiCard label="Replied" value={kpis.waReplied} sub={`of ${kpis.waSent} sent`} icon={MessagesSquare} accent="emerald" />
        </div>
      )}

      <ViewTabs value={activeTab} onChange={setActiveTab} />

      <div className="flex flex-col gap-2.5">
        {activeTab !== "whatsapp" && (
          <StageTabs label="Email" accent="sky" value={emStageTab} onChange={setEmStageTab} counts={emStageCounts} />
        )}
        {activeTab !== "email" && (
          <StageTabs label="WhatsApp" accent="teal" value={waStageTab} onChange={setWaStageTab} counts={waStageCounts} />
        )}
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3 shadow-sm sm:flex-row sm:items-center">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search name, email, phone…" value={search} onChange={(e) => onSearchChange(e.target.value)} className="pl-8" />
        </div>
        <Button variant="outline" size="sm" className="rounded-full" onClick={clearFilters} disabled={!hasActiveFilters}>
          <X className="h-3.5 w-3.5" />
          Clear filters
        </Button>
        <p className="text-xs text-muted-foreground sm:ml-auto sm:text-right">
          Use the ⋮ menu on any column header to sort or filter it — sort multiple columns by clicking them in
          priority order.
        </p>
      </div>

      {error && !adding && <p className="text-sm text-destructive">{error}</p>}

      {importing && pid && <ImportLeadsDialog pid={pid} onClose={() => setImporting(false)} onImported={refreshProjectData} />}

      {statusLogContact && pid && (
        <StatusLogDialog
          pid={pid}
          contactId={statusLogContact.id}
          contactName={statusLogContact.name}
          entries={statusLog.filter((e) => e.contact_id === statusLogContact.id)}
          onClose={() => setStatusLogContact(null)}
          onAdded={refreshProjectData}
        />
      )}

      {sendNow && pid && (
        <SendNowDialog
          pid={pid}
          contactId={sendNow.contact.id}
          contactName={sendNow.contact.name}
          channel={sendNow.channel}
          currentStage={sendNow.channel === "email" ? sendNow.contact.em_stage : sendNow.contact.wa_stage}
          templates={templates}
          onClose={() => setSendNow(null)}
          onSent={refreshProjectData}
        />
      )}

      {adding && (
        <Card>
          <CardContent className="pt-6">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="n">Business name</Label>
                <Input id="n" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="e">Email</Label>
                <Input id="e" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="p">Phone</Label>
                <Input id="p" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
            </div>
            <Button className="mt-4" onClick={addLead} disabled={!name.trim()}>
              Save lead
            </Button>
            {error && <p className="mt-2.5 text-sm text-destructive">{error}</p>}
          </CardContent>
        </Card>
      )}

      {filtered.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              <ColumnHead columnKey="name" label="Business" icon={Users} iconClassName="text-muted-foreground" sort={sort} filterValue={columnFilters.name} onFilterChange={setColumnFilter} onSortChange={setColumnSort} />
              <ColumnHead columnKey="area" label="Location" icon={MapPin} iconClassName="text-muted-foreground" sort={sort} filterValue={columnFilters.area} onFilterChange={setColumnFilter} onSortChange={setColumnSort} />
              {activeTab !== "whatsapp" && (
                <TableHead>
                  <span className="inline-flex items-center gap-1.5">
                    <Mail className="h-3.5 w-3.5 text-sky-600" />
                    Email
                  </span>
                </TableHead>
              )}
              {activeTab !== "email" && (
                <TableHead>
                  <span className="inline-flex items-center gap-1.5">
                    <MessageCircle className="h-3.5 w-3.5 text-teal-600" />
                    WhatsApp
                  </span>
                </TableHead>
              )}
              {activeTab !== "whatsapp" && (
                <ColumnHead
                  columnKey="em_status"
                  label="Email status"
                  icon={Mail}
                  iconClassName="text-sky-600"
                  dataType="select"
                  options={emStatusOptions}
                  sort={sort}
                  filterValue={columnFilters.em_status}
                  onFilterChange={setColumnFilter}
                  onSortChange={setColumnSort}
                />
              )}
              {activeTab !== "email" && (
                <ColumnHead
                  columnKey="wa_status"
                  label="WhatsApp status"
                  icon={MessageCircle}
                  iconClassName="text-teal-600"
                  dataType="select"
                  options={waStatusOptions}
                  sort={sort}
                  filterValue={columnFilters.wa_status}
                  onFilterChange={setColumnFilter}
                  onSortChange={setColumnSort}
                />
              )}
              <ColumnHead
                columnKey="sentiment"
                label="Response / Sentiment"
                icon={MessagesSquare}
                iconClassName="text-violet-600"
                dataType="select"
                options={[...SENTIMENT_VALUES]}
                sort={sort}
                filterValue={columnFilters.sentiment}
                onFilterChange={setColumnFilter}
                onSortChange={setColumnSort}
              />
              <TableHead>
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                  Status log
                </span>
              </TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="[&>tr:nth-child(even)]:bg-muted/30">
            {pageItems.map((c) => {
              const latest = latestStatusByContact.get(c.id);
              return (
                <TableRow key={c.id}>
                  <TableCell className="font-semibold text-foreground">
                    <div className="flex items-center gap-2.5">
                      <BusinessAvatar name={c.name} />
                      <span className="truncate">{c.name}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {c.area ? (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3 w-3 shrink-0 opacity-60" />
                        {c.area}
                      </span>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  {activeTab !== "whatsapp" && (
                    <TableCell className="max-w-[180px] truncate text-muted-foreground" title={c.email ?? undefined}>
                      {c.email ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Mail className="h-3 w-3 shrink-0 opacity-50" />
                          <span className="truncate">{c.email}</span>
                        </span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  )}
                  {activeTab !== "email" && (
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {c.phone ? (
                        <span className="inline-flex items-center gap-1.5">
                          <MessageCircle className="h-3 w-3 shrink-0 opacity-50" />
                          {c.phone}
                        </span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  )}
                  {activeTab !== "whatsapp" && (
                    <TableCell>
                      <StatusBadge status={c.em_status} manual={c.em_manual_last} />
                    </TableCell>
                  )}
                  {activeTab !== "email" && (
                    <TableCell>
                      <StatusBadge status={c.wa_status} manual={c.wa_manual_last} />
                    </TableCell>
                  )}
                  <TableCell>
                    <SentimentPicker value={c.sentiment} onChange={(v) => updateSentiment(c.id, v)} />
                  </TableCell>
                  <TableCell>
                    <button
                      className={cn(
                        "group flex max-w-[190px] flex-col items-start gap-0.5 rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors",
                        latest
                          ? "border-border bg-muted/40 hover:border-primary/40 hover:bg-accent"
                          : "border-dashed border-border text-muted-foreground hover:border-primary hover:bg-accent hover:text-primary"
                      )}
                      onClick={() => setStatusLogContact(c)}
                    >
                      {latest ? (
                        <>
                          <span className="block truncate font-semibold text-foreground group-hover:text-primary">{latest.status}</span>
                          <span className="text-muted-foreground">
                            {new Date(latest.created_at).toLocaleDateString()}
                            {latest.follow_up_date && <> · next {new Date(latest.follow_up_date).toLocaleDateString()}</>}
                          </span>
                        </>
                      ) : (
                        <span className="inline-flex items-center gap-1 font-medium">
                          <Plus className="h-3 w-3" />
                          Add update
                        </span>
                      )}
                    </button>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1 rounded-full border border-border bg-muted/30 p-1">
                      {activeTab !== "whatsapp" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 rounded-full hover:bg-sky-100 hover:text-sky-700"
                          title={validEmail(c.email) ? "Send email now" : "No valid email on file"}
                          disabled={!validEmail(c.email)}
                          onClick={() => setSendNow({ contact: c, channel: "email" })}
                        >
                          <Mail className="h-4 w-4" />
                        </Button>
                      )}
                      {activeTab !== "email" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 rounded-full hover:bg-teal-100 hover:text-teal-700"
                          title={normPhone(c.phone) ? "Send WhatsApp now" : "No valid WhatsApp number on file"}
                          disabled={!normPhone(c.phone)}
                          onClick={() => setSendNow({ contact: c, channel: "whatsapp" })}
                        >
                          <MessageCircle className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      ) : null}

      {filtered.length > PAGE_SIZE && (
        <div className="flex items-center justify-between rounded-xl border border-border bg-card p-3 shadow-sm">
          <p className="text-sm text-muted-foreground">
            Showing{" "}
            <span className="font-semibold tabular-nums text-foreground">
              {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)}
            </span>{" "}
            of <span className="font-semibold tabular-nums text-foreground">{filtered.length}</span>
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="rounded-full" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={currentPage <= 1}>
              <ChevronLeft className="h-3.5 w-3.5" />
              Previous
            </Button>
            <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold tabular-nums text-muted-foreground">
              Page {currentPage} of {pageCount}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="rounded-full"
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              disabled={currentPage >= pageCount}
            >
              Next
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      {!filtered.length && (
        <Card>
          <CardHeader className="items-center gap-2 text-center">
            <FileSpreadsheet className="h-8 w-8 text-muted-foreground" />
            <h2 className="font-display text-lg font-semibold text-foreground">{contacts.length ? "No leads match your filters" : "No leads in this project"}</h2>
            <p className="text-sm text-muted-foreground">
              {contacts.length ? (
                <>
                  Try a different search, or{" "}
                  <button className="text-primary underline underline-offset-4" onClick={clearFilters}>
                    clear filters
                  </button>
                  .
                </>
              ) : (
                <>
                  Add a lead by hand, import an Excel file, or connect a{" "}
                  <a href="/sources" className="text-primary underline underline-offset-4">
                    webhook or website form
                  </a>{" "}
                  to import automatically.
                </>
              )}
            </p>
          </CardHeader>
        </Card>
      )}
    </div>
  );
}
