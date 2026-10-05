"use client";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, FileSpreadsheet, Mail, MessageCircle, Plus, Search, Upload } from "lucide-react";
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

type SortKey = "name" | "area" | "em_status" | "wa_status" | "sentiment";

export default function ContactsPage() {
  const { pid, contacts, templates, statusLog, refreshProjectData } = useWorkspace();
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [sentimentFilter, setSentimentFilter] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "name", dir: "asc" });

  const [statusLogContact, setStatusLogContact] = useState<ContactRow | null>(null);
  const [sendNow, setSendNow] = useState<{ contact: ContactRow; channel: "email" | "whatsapp" } | null>(null);

  const latestStatusByContact = useMemo(() => {
    const map = new Map<string, (typeof statusLog)[number]>();
    for (const entry of statusLog) {
      if (!map.has(entry.contact_id)) map.set(entry.contact_id, entry);
    }
    return map;
  }, [statusLog]);

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = contacts.filter((c) => {
      if (sentimentFilter && c.sentiment !== sentimentFilter) return false;
      if (!q) return true;
      return c.name.toLowerCase().includes(q) || (c.email ?? "").toLowerCase().includes(q) || (c.phone ?? "").toLowerCase().includes(q);
    });
    rows = [...rows].sort((a, b) => {
      const av = (sort.key === "area" ? a.area : a[sort.key]) ?? "";
      const bv = (sort.key === "area" ? b.area : b[sort.key]) ?? "";
      const cmp = String(av).localeCompare(String(bv));
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [contacts, search, sentimentFilter, sort]);

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

  async function updateSentiment(contactId: string, sentiment: string) {
    if (!pid) return;
    await apiFetch(`/v1/projects/${pid}/contacts/${contactId}`, { method: "PATCH", body: JSON.stringify({ sentiment }) });
    await refreshProjectData();
  }

  function SortHead({ sortKey, children }: { sortKey: SortKey; children: React.ReactNode }) {
    const active = sort.key === sortKey;
    const Icon = active ? (sort.dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
    return (
      <TableHead>
        <button className="flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort(sortKey)}>
          {children}
          <Icon className={cn("h-3 w-3", active ? "text-foreground" : "text-muted-foreground/50")} />
        </button>
      </TableHead>
    );
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

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search name, email, phone…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
        </div>
        <Select value={sentimentFilter} onChange={(e) => setSentimentFilter(e.target.value)} className="sm:max-w-[200px]">
          <option value="">All sentiments</option>
          {SENTIMENT_VALUES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </div>

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
              <SortHead sortKey="name">Business</SortHead>
              <SortHead sortKey="area">Location</SortHead>
              <SortHead sortKey="em_status">Email status</SortHead>
              <SortHead sortKey="wa_status">WhatsApp status</SortHead>
              <SortHead sortKey="sentiment">Response / Sentiment</SortHead>
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
                "Try a different search or sentiment filter."
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
