"use client";
import { useEffect, useMemo, useState } from "react";
import { Clock, Loader2, Plus, RefreshCw, Search, X } from "lucide-react";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { apiFetch, ApiError } from "@/lib/apiClient";
import type { ConnectionRow, LeadSourceRow } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ColumnFilter, SortIndicator, type SortDirection } from "@/components/ui/column-filter";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardHeader } from "@/components/ui/card";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type SourceType = "webhook" | "form" | "onedrive" | "google_sheets";

const TYPE_LABEL: Record<SourceType, string> = {
  webhook: "Webhook",
  form: "Website form",
  onedrive: "OneDrive",
  google_sheets: "Google Sheets",
};

type ColumnKey = "name" | "type" | "mode" | "last_sync" | "rows_added" | "rows_skipped" | "rows_failed";
const EMPTY_FILTERS: Record<ColumnKey, string> = { name: "", type: "", mode: "", last_sync: "", rows_added: "", rows_skipped: "", rows_failed: "" };
const NUMERIC_COLUMNS = new Set<ColumnKey>(["rows_added", "rows_skipped", "rows_failed"]);

function sortValue(s: LeadSourceRow, key: ColumnKey): string | number {
  if (key === "name") return s.name;
  if (key === "type") return TYPE_LABEL[s.type as SourceType] ?? s.type;
  if (key === "mode") return s.mode || "Manual";
  if (key === "last_sync") return s.last_sync ?? "";
  if (key === "rows_added") return s.rows_added;
  if (key === "rows_skipped") return s.rows_skipped;
  return s.rows_failed;
}

/** Same reasoning as contacts/page.tsx's ColumnHead — module scope so its
 * dropdown isn't torn down and rebuilt on every render. */
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

  const [search, setSearch] = useState("");
  const [columnFilters, setColumnFilters] = useState<Record<ColumnKey, string>>(EMPTY_FILTERS);
  const [sort, setSort] = useState<{ key: ColumnKey; dir: "asc" | "desc" }[]>([]);

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

  const typeOptions = useMemo(() => Array.from(new Set(sources.map((s) => TYPE_LABEL[s.type as SourceType] ?? s.type))).sort(), [sources]);
  const modeOptions = useMemo(() => Array.from(new Set(sources.map((s) => s.mode || "Manual"))).sort(), [sources]);

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
    setSort([]);
  }

  const filteredSources = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = sources.filter((s) => {
      if (columnFilters.name && !s.name.toLowerCase().includes(columnFilters.name.toLowerCase())) return false;
      if (columnFilters.type && (TYPE_LABEL[s.type as SourceType] ?? s.type) !== columnFilters.type) return false;
      if (columnFilters.mode && (s.mode || "Manual") !== columnFilters.mode) return false;
      if (!q) return true;
      return s.name.toLowerCase().includes(q) || (s.detail ?? "").toLowerCase().includes(q);
    });
    if (sort.length) {
      rows = [...rows].sort((a, b) => {
        for (const { key, dir } of sort) {
          const av = sortValue(a, key);
          const bv = sortValue(b, key);
          const cmp = NUMERIC_COLUMNS.has(key) ? (av as number) - (bv as number) : String(av).localeCompare(String(bv));
          if (cmp !== 0) return dir === "asc" ? cmp : -cmp;
        }
        return 0;
      });
    }
    return rows;
  }, [sources, search, columnFilters, sort]);

  return (
    <>
      <div className="top">
        <div>
          <h1>Lead sources</h1>
          <p>Webhook, website-form, OneDrive, and Google Sheets intake are live. CRM sync (Zoho/HubSpot) isn&apos;t built yet.</p>
        </div>
        <div className="row">
          <Button onClick={() => setAdding((v) => !v)}>
            <Plus className="h-4 w-4" />
            Add source
          </Button>
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
        <div className="flex flex-col items-center gap-2 py-24 text-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading sources…</p>
        </div>
      ) : sources.length ? (
        <>
          <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3 shadow-sm sm:flex-row sm:items-center">
            <div className="relative flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Search name, detail…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
            </div>
            <Button variant="outline" size="sm" className="rounded-full" onClick={clearFilters} disabled={!hasActiveFilters}>
              <X className="h-3.5 w-3.5" />
              Clear filters
            </Button>
            <p className="text-xs text-muted-foreground sm:ml-auto sm:text-right">
              {filteredSources.length} of {sources.length} sources — use the ⋮ menu on a column to sort or filter it.
            </p>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <ColumnHead columnKey="name" label="Source" sort={sort} filterValue={columnFilters.name} onFilterChange={setColumnFilter} onSortChange={setColumnSort} />
                <ColumnHead
                  columnKey="type"
                  label="Type"
                  dataType="select"
                  options={typeOptions}
                  sort={sort}
                  filterValue={columnFilters.type}
                  onFilterChange={setColumnFilter}
                  onSortChange={setColumnSort}
                />
                <ColumnHead
                  columnKey="mode"
                  label="Sync"
                  dataType="select"
                  options={modeOptions}
                  sort={sort}
                  filterValue={columnFilters.mode}
                  onFilterChange={setColumnFilter}
                  onSortChange={setColumnSort}
                />
                <ColumnHead columnKey="last_sync" label="Last sync" sort={sort} filterValue={columnFilters.last_sync} onFilterChange={setColumnFilter} onSortChange={setColumnSort} />
                <ColumnHead columnKey="rows_added" label="Leads" sort={sort} filterValue={columnFilters.rows_added} onFilterChange={setColumnFilter} onSortChange={setColumnSort} />
                <ColumnHead columnKey="rows_skipped" label="Skipped" sort={sort} filterValue={columnFilters.rows_skipped} onFilterChange={setColumnFilter} onSortChange={setColumnSort} />
                <ColumnHead columnKey="rows_failed" label="Failed" sort={sort} filterValue={columnFilters.rows_failed} onFilterChange={setColumnFilter} onSortChange={setColumnSort} />
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="[&>tr:nth-child(even)]:bg-muted/30">
              {filteredSources.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-semibold text-foreground">
                    {s.name}
                    {s.detail && <div className="text-xs font-normal text-muted-foreground">{s.detail}</div>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{TYPE_LABEL[s.type as SourceType] ?? s.type}</TableCell>
                  <TableCell className="text-muted-foreground">{s.mode || "Manual"}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {s.last_sync ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Clock className="h-3 w-3 shrink-0 opacity-50" />
                        {new Date(s.last_sync).toLocaleString()}
                      </span>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="font-semibold tabular-nums text-foreground">{s.rows_added}</TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">{s.rows_skipped}</TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">{s.rows_failed}</TableCell>
                  <TableCell>
                    {(s.type === "webhook" || s.type === "form") && (
                      <Button variant="outline" size="sm" onClick={() => generateToken(s.id)}>
                        {s.last_sync ? "Rotate token" : "Generate token"}
                      </Button>
                    )}
                    {(s.type === "onedrive" || s.type === "google_sheets") && (
                      <Button variant="outline" size="sm" disabled={syncingId === s.id} onClick={() => syncNow(s.id)}>
                        {syncingId === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                        {syncingId === s.id ? "Syncing…" : "Sync now"}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!filteredSources.length && <p className="text-center text-sm text-muted-foreground">No sources match your filters.</p>}
        </>
      ) : (
        <Card>
          <CardHeader className="items-center gap-2 text-center">
            <h2 className="font-display text-lg font-semibold text-foreground">No sources yet</h2>
            <p className="text-sm text-muted-foreground">Add a webhook, website form, OneDrive, or Google Sheets source above to start importing leads.</p>
          </CardHeader>
        </Card>
      )}
    </>
  );
}
