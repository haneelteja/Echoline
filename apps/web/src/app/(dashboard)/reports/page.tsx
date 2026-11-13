"use client";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Loader2, Mail, Search, Send, X } from "lucide-react";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { apiFetch, ApiError } from "@/lib/apiClient";
import type { MessageEventRow, ReportConfigRow, ReportType } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SortIndicator, type SortDirection } from "@/components/ui/column-filter";

const TAB_LABEL: Record<ReportType, string> = {
  new_leads: "New leads",
  leads_by_source: "Leads by source",
  emails_sent: "Emails sent",
  whatsapp_sent: "WhatsApp sent",
};
const EMPTY_FILTERS = { dateFrom: "", dateTo: "", search: "", area: "", source: "" };
const PAGE_SIZE_OPTIONS = [20, 50, 100, 200];

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

type SentChannel = "em" | "wa";
type SentColumnKey = "occurred_at" | "contact" | "to" | "area" | "source";

/** Whichever address a send actually used — falls back to raw_email/
 * raw_phone the same way the Activity log does, so an "invalid format" send
 * still shows up instead of rendering blank. */
function sentTo(ev: MessageEventRow, channel: SentChannel): string {
  const c = ev.contacts;
  return channel === "em" ? c?.email || c?.raw_email || "" : c?.phone || c?.raw_phone || "";
}

function sentSortValue(ev: MessageEventRow, channel: SentChannel, key: SentColumnKey): string {
  if (key === "occurred_at") return ev.occurred_at;
  if (key === "contact") return ev.contacts?.name ?? "";
  if (key === "to") return sentTo(ev, channel);
  if (key === "area") return ev.contacts?.area ?? "";
  return ev.contacts?.source ?? "";
}

/** Clickable column header for the Emails/WhatsApp sent tables — a lighter
 * single-column sort than Activity log's per-column ColumnFilter dropdown,
 * since this page's existing top filter bar (date range/search/area/source)
 * already covers filtering for these tabs. */
function SortableHead({ label, active, onClick }: { label: string; active: SortDirection; onClick: () => void }) {
  return (
    <TableHead>
      <button type="button" className="flex items-center gap-1 text-left" onClick={onClick}>
        <span>{label}</span>
        <SortIndicator direction={active} />
      </button>
    </TableHead>
  );
}

export default function ReportsPage() {
  const { pid, contacts } = useWorkspace();
  const [tab, setTab] = useState<ReportType>("new_leads");

  const [dateFrom, setDateFrom] = useState(EMPTY_FILTERS.dateFrom);
  const [dateTo, setDateTo] = useState(EMPTY_FILTERS.dateTo);
  const [search, setSearch] = useState(EMPTY_FILTERS.search);
  const [areaFilter, setAreaFilter] = useState(EMPTY_FILTERS.area);
  const [sourceFilter, setSourceFilter] = useState(EMPTY_FILTERS.source);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE_OPTIONS[0]);
  const [sentSort, setSentSort] = useState<{ key: SentColumnKey; dir: "asc" | "desc" }>({ key: "occurred_at", dir: "desc" });

  const [sentEvents, setSentEvents] = useState<MessageEventRow[]>([]);
  const [loadingSentEvents, setLoadingSentEvents] = useState(true);

  const [configs, setConfigs] = useState<ReportConfigRow[]>([]);
  const [loadingConfigs, setLoadingConfigs] = useState(true);

  const [recipientEmail, setRecipientEmail] = useState("");
  const [format, setFormat] = useState<"table" | "excel">("table");
  const [sendTime, setSendTime] = useState("09:00");
  const [enabled, setEnabled] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [configSaved, setConfigSaved] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [sendingTest, setSendingTest] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  async function loadConfigs() {
    if (!pid) return;
    setLoadingConfigs(true);
    try {
      const data = await apiFetch<ReportConfigRow[]>(`/v1/projects/${pid}/reports/configs`);
      setConfigs(data);
    } catch {
      setConfigs([]);
    } finally {
      setLoadingConfigs(false);
    }
  }

  useEffect(() => {
    loadConfigs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid]);

  useEffect(() => {
    if (!pid) return;
    setLoadingSentEvents(true);
    apiFetch<MessageEventRow[]>(`/v1/projects/${pid}/activity/sent`)
      .then(setSentEvents)
      .catch(() => setSentEvents([]))
      .finally(() => setLoadingSentEvents(false));
  }, [pid]);

  useEffect(() => {
    const cfg = configs.find((c) => c.report_type === tab);
    setRecipientEmail(cfg?.recipient_email ?? "");
    setFormat(cfg?.format ?? "table");
    setSendTime(cfg?.send_time?.slice(0, 5) ?? "09:00");
    setEnabled(cfg?.enabled ?? false);
    setConfigSaved(false);
    setConfigError(null);
    setTestResult(null);
  }, [tab, configs]);

  const areaOptions = useMemo(() => Array.from(new Set(contacts.map((c) => c.area).filter((v): v is string => Boolean(v)))).sort(), [contacts]);
  const sourceOptions = useMemo(() => Array.from(new Set(contacts.map((c) => c.source).filter((v): v is string => Boolean(v)))).sort(), [contacts]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return contacts.filter((c) => {
      const day = c.created_at.slice(0, 10);
      if (dateFrom && day < dateFrom) return false;
      if (dateTo && day > dateTo) return false;
      if (areaFilter && c.area !== areaFilter) return false;
      if (sourceFilter && c.source !== sourceFilter) return false;
      if (!q) return true;
      return c.name.toLowerCase().includes(q) || (c.email ?? "").toLowerCase().includes(q) || (c.phone ?? "").includes(q);
    });
  }, [contacts, dateFrom, dateTo, areaFilter, sourceFilter, search]);

  const bySource = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of filtered) {
      const key = c.source || "Unknown";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [filtered]);

  // Shares the same date-range/search/area/source filters as the New leads
  // tab, just applied to message_events (occurred_at, joined contact) rather
  // than contacts (created_at) — so filtering stays "specific to the tab"
  // without duplicating five separate filter widgets per tab.
  function filterSentEvents(events: MessageEventRow[], channel: SentChannel): MessageEventRow[] {
    const q = search.trim().toLowerCase();
    return events.filter((ev) => {
      const day = ev.occurred_at.slice(0, 10);
      if (dateFrom && day < dateFrom) return false;
      if (dateTo && day > dateTo) return false;
      if (areaFilter && ev.contacts?.area !== areaFilter) return false;
      if (sourceFilter && ev.contacts?.source !== sourceFilter) return false;
      if (!q) return true;
      return (ev.contacts?.name ?? "").toLowerCase().includes(q) || sentTo(ev, channel).toLowerCase().includes(q);
    });
  }

  function sortSentEvents(events: MessageEventRow[], channel: SentChannel): MessageEventRow[] {
    return [...events].sort((a, b) => {
      const cmp = sentSortValue(a, channel, sentSort.key).localeCompare(sentSortValue(b, channel, sentSort.key));
      return sentSort.dir === "asc" ? cmp : -cmp;
    });
  }

  function toggleSentSort(key: SentColumnKey) {
    setSentSort((cur) => (cur.key === key ? { key, dir: cur.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  }

  const emailsSent = useMemo(
    () => sortSentEvents(filterSentEvents(sentEvents.filter((ev) => ev.channel === "em"), "em"), "em"),
    [sentEvents, dateFrom, dateTo, areaFilter, sourceFilter, search, sentSort]
  );
  const whatsappSent = useMemo(
    () => sortSentEvents(filterSentEvents(sentEvents.filter((ev) => ev.channel === "wa"), "wa"), "wa"),
    [sentEvents, dateFrom, dateTo, areaFilter, sourceFilter, search, sentSort]
  );

  // Pagination keeps the table from rendering hundreds of rows in one React
  // commit — same technique as the Contacts page, but with a configurable
  // page size here since report exports can span a much wider date range.
  const totalRows =
    tab === "new_leads" ? filtered.length : tab === "leads_by_source" ? bySource.length : tab === "emails_sent" ? emailsSent.length : whatsappSent.length;
  const pageCount = Math.max(1, Math.ceil(totalRows / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pagedLeads = useMemo(() => filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize), [filtered, currentPage, pageSize]);
  const pagedSource = useMemo(() => bySource.slice((currentPage - 1) * pageSize, currentPage * pageSize), [bySource, currentPage, pageSize]);
  const pagedEmailsSent = useMemo(() => emailsSent.slice((currentPage - 1) * pageSize, currentPage * pageSize), [emailsSent, currentPage, pageSize]);
  const pagedWhatsappSent = useMemo(() => whatsappSent.slice((currentPage - 1) * pageSize, currentPage * pageSize), [whatsappSent, currentPage, pageSize]);

  useEffect(() => {
    setPage(1);
  }, [tab, dateFrom, dateTo, search, areaFilter, sourceFilter, pageSize]);

  const hasActiveFilters = Boolean(dateFrom || dateTo || search || areaFilter || sourceFilter);
  function clearFilters() {
    setDateFrom(EMPTY_FILTERS.dateFrom);
    setDateTo(EMPTY_FILTERS.dateTo);
    setSearch(EMPTY_FILTERS.search);
    setAreaFilter(EMPTY_FILTERS.area);
    setSourceFilter(EMPTY_FILTERS.source);
  }

  function exportCurrentView() {
    const header =
      tab === "new_leads"
        ? ["Name", "Email", "Phone", "Category", "Area", "Source", "Added"]
        : tab === "leads_by_source"
          ? ["Source", "Leads"]
          : ["Contact", "To", "Area", "Source", "Sent at"];
    const lines = [header.join(",")];
    if (tab === "new_leads") {
      for (const c of filtered) {
        lines.push(
          [c.name, c.email ?? "", c.phone ?? "", c.category ?? "", c.area ?? "", c.source ?? "", new Date(c.created_at).toLocaleString()]
            .map(csvCell)
            .join(",")
        );
      }
    } else if (tab === "leads_by_source") {
      for (const [source, count] of bySource) lines.push([source, String(count)].map(csvCell).join(","));
    } else {
      const channel: SentChannel = tab === "emails_sent" ? "em" : "wa";
      for (const ev of tab === "emails_sent" ? emailsSent : whatsappSent) {
        lines.push(
          [ev.contacts?.name ?? "", sentTo(ev, channel), ev.contacts?.area ?? "", ev.contacts?.source ?? "", new Date(ev.occurred_at).toLocaleString()]
            .map(csvCell)
            .join(",")
        );
      }
    }
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${tab}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function saveConfig() {
    if (!pid) return;
    setSavingConfig(true);
    setConfigError(null);
    setConfigSaved(false);
    try {
      await apiFetch(`/v1/projects/${pid}/reports/configs/${tab}`, {
        method: "PUT",
        body: JSON.stringify({ recipientEmail, format, sendTime, enabled }),
      });
      setConfigSaved(true);
      await loadConfigs();
    } catch (e) {
      setConfigError(e instanceof ApiError ? e.message : "Couldn't save.");
    } finally {
      setSavingConfig(false);
    }
  }

  async function sendTestNow() {
    if (!pid) return;
    setSendingTest(true);
    setTestResult(null);
    setConfigError(null);
    try {
      const res = await apiFetch<{ ok: boolean; sentTo: string; rows: number }>(`/v1/projects/${pid}/reports/configs/${tab}/send-test`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      setTestResult(`Sent to ${res.sentTo} (${res.rows} rows).`);
    } catch (e) {
      setConfigError(e instanceof ApiError ? e.message : "Couldn't send test.");
    } finally {
      setSendingTest(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-foreground">Reports</h1>
        <p className="text-sm text-muted-foreground">
          Filter and export leads, and configure a daily email digest — sent via Echoline&apos;s own platform email, independently of
          any project connection.
        </p>
      </div>

      <div className="flex gap-2">
        {(Object.keys(TAB_LABEL) as ReportType[]).map((t) => (
          <Button key={t} variant={tab === t ? "default" : "outline"} size="sm" onClick={() => setTab(t)}>
            {TAB_LABEL[t]}
          </Button>
        ))}
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3 shadow-sm sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search name, email, phone…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" title="Searches contact name, email and phone" />
        </div>
        <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-auto" title="From date" />
        <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-auto" title="To date" />
        <Select value={areaFilter} onChange={(e) => setAreaFilter(e.target.value)} className="w-auto">
          <option value="">All areas</option>
          {areaOptions.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </Select>
        <Select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} className="w-auto">
          <option value="">All sources</option>
          {sourceOptions.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Button variant="outline" size="sm" className="rounded-full" onClick={clearFilters} disabled={!hasActiveFilters}>
          <X className="h-3.5 w-3.5" />
          Clear filters
        </Button>
        <Button variant="outline" size="sm" className="rounded-full sm:ml-auto" onClick={exportCurrentView}>
          <Download className="h-3.5 w-3.5" />
          Export
        </Button>
      </div>

      {(tab === "emails_sent" || tab === "whatsapp_sent") && loadingSentEvents ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading…</p>
        </div>
      ) : tab === "new_leads" ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Area</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Added</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="[&>tr:nth-child(even)]:bg-muted/30">
            {pagedLeads.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium text-foreground">{c.name}</TableCell>
                <TableCell className="text-muted-foreground">{c.email || "—"}</TableCell>
                <TableCell className="text-muted-foreground">{c.phone || "—"}</TableCell>
                <TableCell className="text-muted-foreground">{c.category || "—"}</TableCell>
                <TableCell className="text-muted-foreground">{c.area || "—"}</TableCell>
                <TableCell className="text-muted-foreground">{c.source || "—"}</TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">{new Date(c.created_at).toLocaleString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : tab === "leads_by_source" ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Source</TableHead>
              <TableHead>Leads</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="[&>tr:nth-child(even)]:bg-muted/30">
            {pagedSource.map(([source, count]) => (
              <TableRow key={source}>
                <TableCell className="font-medium text-foreground">{source}</TableCell>
                <TableCell className="tabular-nums text-muted-foreground">{count}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHead label="Contact" active={sentSort.key === "contact" ? sentSort.dir : null} onClick={() => toggleSentSort("contact")} />
              <SortableHead label={tab === "emails_sent" ? "Email" : "Phone"} active={sentSort.key === "to" ? sentSort.dir : null} onClick={() => toggleSentSort("to")} />
              <SortableHead label="Area" active={sentSort.key === "area" ? sentSort.dir : null} onClick={() => toggleSentSort("area")} />
              <SortableHead label="Source" active={sentSort.key === "source" ? sentSort.dir : null} onClick={() => toggleSentSort("source")} />
              <SortableHead label="Sent at" active={sentSort.key === "occurred_at" ? sentSort.dir : null} onClick={() => toggleSentSort("occurred_at")} />
            </TableRow>
          </TableHeader>
          <TableBody className="[&>tr:nth-child(even)]:bg-muted/30">
            {(tab === "emails_sent" ? pagedEmailsSent : pagedWhatsappSent).map((ev) => (
              <TableRow key={ev.id}>
                <TableCell className="font-medium text-foreground">{ev.contacts?.name ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">{sentTo(ev, tab === "emails_sent" ? "em" : "wa") || "—"}</TableCell>
                <TableCell className="text-muted-foreground">{ev.contacts?.area || "—"}</TableCell>
                <TableCell className="text-muted-foreground">{ev.contacts?.source || "—"}</TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">{new Date(ev.occurred_at).toLocaleString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {!totalRows && !loadingConfigs && !loadingSentEvents && <p className="text-center text-sm text-muted-foreground">No rows match your filters.</p>}

      {totalRows > 0 && (
        <div className="flex flex-col items-center justify-between gap-3 rounded-xl border border-border bg-card p-3 shadow-sm sm:flex-row">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>
              Showing{" "}
              <span className="font-semibold tabular-nums text-foreground">
                {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, totalRows)}
              </span>{" "}
              of <span className="font-semibold tabular-nums text-foreground">{totalRows}</span>
            </span>
            <Select value={String(pageSize)} onChange={(e) => setPageSize(Number(e.target.value))} className="w-auto">
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n} rows
                </option>
              ))}
            </Select>
          </div>
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

      <Card>
        <CardHeader className="flex-row items-center gap-2 space-y-0">
          <Mail className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-display text-base font-semibold text-foreground">Daily email — {TAB_LABEL[tab]}</h2>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {loadingConfigs ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="recipientEmail" required>
                    Recipient email
                  </Label>
                  <Input id="recipientEmail" type="email" value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)} placeholder="you@company.com" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="format">Format</Label>
                  <Select id="format" value={format} onChange={(e) => setFormat(e.target.value as "table" | "excel")}>
                    <option value="table">Inline table</option>
                    <option value="excel">Excel attachment</option>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="sendTime">Send time</Label>
                  <Input id="sendTime" type="time" value={sendTime} onChange={(e) => setSendTime(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="enabled">Enabled</Label>
                  <label className="flex h-9 items-center gap-2 text-sm text-foreground">
                    <input id="enabled" type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
                    Send automatically every day
                  </label>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button onClick={saveConfig} disabled={savingConfig || !recipientEmail.trim()}>
                  {savingConfig ? "Saving…" : "Save"}
                </Button>
                <Button variant="outline" onClick={sendTestNow} disabled={sendingTest}>
                  {sendingTest ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  {sendingTest ? "Sending…" : "Send test now"}
                </Button>
                {configSaved && <span className="text-sm font-medium text-success">Saved.</span>}
                {testResult && <span className="text-sm font-medium text-success">{testResult}</span>}
              </div>
              {configError && <p className="text-sm text-destructive">{configError}</p>}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
