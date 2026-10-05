"use client";
import { useMemo, useState } from "react";
import { FileSpreadsheet, Mail, MessageCircle, MessagesSquare, Plus, Search, Upload, Users, X } from "lucide-react";
import { SENTIMENT_VALUES, statusLabel, type ContactChannelStatus } from "@echoline/core";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { apiFetch, ApiError } from "@/lib/apiClient";
import type { ContactRow } from "@/lib/types";
import { ImportLeadsDialog } from "@/components/ImportLeadsDialog";
import { StatusLogDialog } from "@/components/StatusLogDialog";
import { SendNowDialog } from "@/components/SendNowDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { KpiCard } from "@/components/ui/kpi-card";
import { ColumnFilter, SortIndicator, type SortDirection } from "@/components/ui/column-filter";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

const TERMINAL_GOOD: ContactChannelStatus[] = ["completed", "replied"];
const TERMINAL_BAD: ContactChannelStatus[] = ["opted_out", "invalid", "bounced", "failed"];

function statusVariant(status: ContactChannelStatus): "success" | "destructive" | "secondary" | "default" {
  if (TERMINAL_GOOD.includes(status)) return "success";
  if (TERMINAL_BAD.includes(status)) return "destructive";
  if (status === "not_contacted") return "secondary";
  return "default";
}

function sentimentVariant(sentiment: string): "success" | "destructive" | "secondary" | "default" {
  if (sentiment === "Converted" || sentiment === "Interested" || sentiment === "Offer Made") return "success";
  if (sentiment === "Not Interested" || sentiment === "Lost") return "destructive";
  if (sentiment === "Not Contacted") return "secondary";
  return "default";
}

type ColumnKey = "name" | "area" | "em_status" | "wa_status" | "sentiment";

const EMPTY_FILTERS: Record<ColumnKey, string> = { name: "", area: "", em_status: "", wa_status: "", sentiment: "" };

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
  sort: { key: ColumnKey; dir: "asc" | "desc" } | null;
  filterValue: string;
  onFilterChange: (key: ColumnKey, value: string) => void;
  onSortChange: (key: ColumnKey, dir: SortDirection) => void;
}) {
  const dir = sort?.key === columnKey ? sort.dir : null;
  return (
    <TableHead>
      <div className="flex items-center gap-1">
        <span>{label}</span>
        <SortIndicator direction={dir} />
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
  const { pid, contacts, templates, statusLog, refreshProjectData } = useWorkspace();
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [columnFilters, setColumnFilters] = useState<Record<ColumnKey, string>>(EMPTY_FILTERS);
  const [sort, setSort] = useState<{ key: ColumnKey; dir: "asc" | "desc" } | null>(null);

  const [statusLogContact, setStatusLogContact] = useState<ContactRow | null>(null);
  const [sendNow, setSendNow] = useState<{ contact: ContactRow; channel: "email" | "whatsapp" } | null>(null);

  const kpis = useMemo(() => {
    const total = contacts.length;
    const emailSent = contacts.filter((c) => c.em_stage > 0).length;
    const waSent = contacts.filter((c) => c.wa_stage > 0).length;
    const replied = contacts.filter((c) => c.em_status === "replied" || c.wa_status === "replied").length;
    return { total, emailSent, waSent, replied };
  }, [contacts]);

  const emStatusOptions = useMemo(() => Array.from(new Set(contacts.map((c) => statusLabel(c.em_status)))).sort(), [contacts]);
  const waStatusOptions = useMemo(() => Array.from(new Set(contacts.map((c) => statusLabel(c.wa_status)))).sort(), [contacts]);

  const latestStatusByContact = useMemo(() => {
    const map = new Map<string, (typeof statusLog)[number]>();
    for (const entry of statusLog) {
      if (!map.has(entry.contact_id)) map.set(entry.contact_id, entry);
    }
    return map;
  }, [statusLog]);

  function setColumnFilter(key: ColumnKey, value: string) {
    setColumnFilters((f) => ({ ...f, [key]: value }));
  }

  function setColumnSort(key: ColumnKey, dir: SortDirection) {
    setSort(dir ? { key, dir } : null);
  }

  const hasActiveFilters = Boolean(search) || Object.values(columnFilters).some(Boolean) || sort !== null;

  function clearFilters() {
    setSearch("");
    setColumnFilters(EMPTY_FILTERS);
    setSort(null);
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = contacts.filter((c) => {
      if (columnFilters.name && !c.name.toLowerCase().includes(columnFilters.name.toLowerCase())) return false;
      if (columnFilters.area && !(c.area ?? "").toLowerCase().includes(columnFilters.area.toLowerCase())) return false;
      if (columnFilters.em_status && statusLabel(c.em_status) !== columnFilters.em_status) return false;
      if (columnFilters.wa_status && statusLabel(c.wa_status) !== columnFilters.wa_status) return false;
      if (columnFilters.sentiment && c.sentiment !== columnFilters.sentiment) return false;
      if (!q) return true;
      return c.name.toLowerCase().includes(q) || (c.email ?? "").toLowerCase().includes(q) || (c.phone ?? "").toLowerCase().includes(q);
    });
    if (sort) {
      const { key, dir } = sort;
      rows = [...rows].sort((a, b) => {
        const cmp = sortValue(a, key).localeCompare(sortValue(b, key));
        return dir === "asc" ? cmp : -cmp;
      });
    }
    return rows;
  }, [contacts, search, columnFilters, sort]);

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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">Leads &amp; status</h1>
          <p className="text-sm text-muted-foreground">
            {filtered.length} of {contacts.length} leads
          </p>
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

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <KpiCard label="Total leads" value={kpis.total} icon={Users} accent="purple" />
        <KpiCard label="Email sent" value={kpis.emailSent} sub={`of ${kpis.total}`} icon={Mail} accent="sky" />
        <KpiCard label="WhatsApp sent" value={kpis.waSent} sub={`of ${kpis.total}`} icon={MessageCircle} accent="teal" />
        <KpiCard label="Replied" value={kpis.replied} sub="across both channels" icon={MessagesSquare} accent="emerald" />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search name, email, phone…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
        </div>
        <Button variant="outline" size="sm" onClick={clearFilters} disabled={!hasActiveFilters}>
          <X className="h-3.5 w-3.5" />
          Clear filters
        </Button>
        <p className="text-xs text-muted-foreground">Use the ⋮ menu on any column header to sort or filter it.</p>
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
          templates={templates}
          onClose={() => setSendNow(null)}
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
              <ColumnHead columnKey="name" label="Business" sort={sort} filterValue={columnFilters.name} onFilterChange={setColumnFilter} onSortChange={setColumnSort} />
              <ColumnHead columnKey="area" label="Location" sort={sort} filterValue={columnFilters.area} onFilterChange={setColumnFilter} onSortChange={setColumnSort} />
              <ColumnHead
                columnKey="em_status"
                label="Email status"
                dataType="select"
                options={emStatusOptions}
                sort={sort}
                filterValue={columnFilters.em_status}
                onFilterChange={setColumnFilter}
                onSortChange={setColumnSort}
              />
              <ColumnHead
                columnKey="wa_status"
                label="WhatsApp status"
                dataType="select"
                options={waStatusOptions}
                sort={sort}
                filterValue={columnFilters.wa_status}
                onFilterChange={setColumnFilter}
                onSortChange={setColumnSort}
              />
              <ColumnHead
                columnKey="sentiment"
                label="Response / Sentiment"
                dataType="select"
                options={[...SENTIMENT_VALUES]}
                sort={sort}
                filterValue={columnFilters.sentiment}
                onFilterChange={setColumnFilter}
                onSortChange={setColumnSort}
              />
              <TableHead>Status log</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((c) => {
              const latest = latestStatusByContact.get(c.id);
              return (
                <TableRow key={c.id}>
                  <TableCell className="font-semibold text-foreground">{c.name}</TableCell>
                  <TableCell className="text-muted-foreground">{c.area || "—"}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(c.em_status)}>{statusLabel(c.em_status)}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(c.wa_status)}>{statusLabel(c.wa_status)}</Badge>
                  </TableCell>
                  <TableCell>
                    <Select
                      value={c.sentiment}
                      onChange={(e) => updateSentiment(c.id, e.target.value)}
                      className={cn(
                        "h-7 w-[150px] text-xs",
                        sentimentVariant(c.sentiment) === "success" && "border-success/30 text-success",
                        sentimentVariant(c.sentiment) === "destructive" && "border-destructive/30 text-destructive"
                      )}
                    >
                      {SENTIMENT_VALUES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </Select>
                  </TableCell>
                  <TableCell>
                    <button
                      className="max-w-[180px] text-left text-xs text-muted-foreground hover:text-foreground hover:underline"
                      onClick={() => setStatusLogContact(c)}
                    >
                      {latest ? (
                        <>
                          <span className="block truncate text-foreground">{latest.status}</span>
                          <span>
                            {new Date(latest.created_at).toLocaleDateString()}
                            {latest.follow_up_date && <> · next {new Date(latest.follow_up_date).toLocaleDateString()}</>}
                          </span>
                        </>
                      ) : (
                        "+ Add update"
                      )}
                    </button>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" title="Send email now" onClick={() => setSendNow({ contact: c, channel: "email" })}>
                        <Mail className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" title="Send WhatsApp now" onClick={() => setSendNow({ contact: c, channel: "whatsapp" })}>
                        <MessageCircle className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      ) : (
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
