"use client";
import { Fragment, useEffect, useMemo, useState } from "react";
import { Archive, ArchiveRestore, Clock, Loader2, Pause, Pencil, Play, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";
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

function describeSourceConfig(s: LeadSourceRow): string {
  if (s.detail) return s.detail;
  if (s.type === "onedrive") return `${s.config?.path ?? "—"} · ${s.config?.table ?? "—"}`;
  if (s.type === "google_sheets") return `Sheet: ${s.config?.spreadsheetId ?? "—"} · Range: ${s.config?.range ?? "—"}`;
  return "—";
}

function sortValue(s: LeadSourceRow, key: ColumnKey): string | number {
  if (key === "name") return s.name;
  if (key === "type") return TYPE_LABEL[s.type as SourceType] ?? s.type;
  if (key === "mode") return s.paused ? "Paused" : s.mode || "Manual";
  if (key === "last_sync") return s.last_sync ?? "";
  if (key === "rows_added") return s.rows_added;
  if (key === "rows_skipped") return s.rows_skipped;
  return s.rows_failed;
}

/** Splits a stored "Sheet name!A1:Z"-style range into its two parts; a bare
 * "Sheet name" (no "!") means the whole sheet, no cell sub-range. */
function splitSheetRange(raw: string): { sheetName: string; cellRange: string } {
  const i = raw.indexOf("!");
  return i === -1 ? { sheetName: raw, cellRange: "" } : { sheetName: raw.slice(0, i), cellRange: raw.slice(i + 1) };
}

/** Joins sheet name + optional cell sub-range back into the Sheets API's A1
 * notation; an empty cellRange means "whole sheet" (bare tab name is valid
 * A1 notation on its own — no "!A1:Z" suffix required). */
function joinSheetRange(sheetName: string, cellRange: string): string {
  return cellRange.trim() ? `${sheetName}!${cellRange.trim()}` : sheetName;
}

/** Same reasoning as contacts/page.tsx's ColumnHead — module scope so its
 * dropdown isn't torn down and rebuilt on every render. */
/** Shared by the add and edit panels. A project can have more than one
 * connected Google account (one per Google account, see the "Connect a
 * sheet/workbook account" panel), so a source first picks *which* account
 * to sync through, then picks a real spreadsheet from that account's own
 * Drive — no pasted ID, no way to enter a wrong one. Sheet name and the
 * optional cell sub-range stay two separate fields rather than one combined
 * "Sheet1!A1:Z" string, so a sheet name with spaces/emoji never needs
 * manual A1-notation assembly — leaving the cell range blank means the
 * whole sheet. */
function GoogleSheetsFields({
  googleConnections,
  googleConnectionId,
  spreadsheetId,
  sheetFiles,
  fetchingFiles,
  sheetName,
  cellRange,
  sheetTabs,
  fetchingTabs,
  idPrefix,
  onGoogleConnectionChange,
  onFetchFiles,
  onSpreadsheetIdChange,
  onSheetNameChange,
  onCellRangeChange,
  onFetchTabs,
}: {
  googleConnections: ConnectionRow[];
  googleConnectionId: string;
  spreadsheetId: string;
  sheetFiles: { id: string; name: string }[];
  fetchingFiles: boolean;
  sheetName: string;
  cellRange: string;
  sheetTabs: string[];
  fetchingTabs: boolean;
  idPrefix: string;
  onGoogleConnectionChange: (v: string) => void;
  onFetchFiles: () => void;
  onSpreadsheetIdChange: (v: string) => void;
  onSheetNameChange: (v: string) => void;
  onCellRangeChange: (v: string) => void;
  onFetchTabs: () => void;
}) {
  return (
    <div className="grid g3" style={{ marginTop: 10 }}>
      <div className="field">
        <label htmlFor={`${idPrefix}gsacct`}>Google account</label>
        <select id={`${idPrefix}gsacct`} value={googleConnectionId} onChange={(e) => onGoogleConnectionChange(e.target.value)}>
          <option value="">Select a connected account…</option>
          {googleConnections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.account_label ?? "Connected account"}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}gsfile`}>Spreadsheet</label>
        <div className="row" style={{ gap: 6 }}>
          {sheetFiles.length > 0 ? (
            <select id={`${idPrefix}gsfile`} value={spreadsheetId} onChange={(e) => onSpreadsheetIdChange(e.target.value)} style={{ flex: 1 }}>
              {sheetFiles.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="small muted" style={{ flex: 1 }}>
              {spreadsheetId ? "Click \"Fetch sheets\" to refresh the list." : "No spreadsheet selected yet."}
            </span>
          )}
          <button type="button" className="btn" disabled={fetchingFiles || !googleConnectionId} onClick={onFetchFiles}>
            {fetchingFiles ? "Fetching…" : "Fetch sheets"}
          </button>
        </div>
        <p className="small muted" style={{ marginTop: 4 }}>
          Lists the real spreadsheets in that Google account&apos;s Drive — only native Google Sheets, never an unconverted Excel file.
        </p>
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}gssheet`}>Sheet (tab) name</label>
        <div className="row" style={{ gap: 6 }}>
          {sheetTabs.length > 0 ? (
            <select id={`${idPrefix}gssheet`} value={sheetName} onChange={(e) => onSheetNameChange(e.target.value)} style={{ flex: 1 }}>
              {sheetTabs.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          ) : (
            <input
              id={`${idPrefix}gssheet`}
              value={sheetName}
              onChange={(e) => onSheetNameChange(e.target.value)}
              placeholder="Sheet1"
              style={{ flex: 1 }}
            />
          )}
          <button type="button" className="btn" disabled={fetchingTabs || !spreadsheetId} onClick={onFetchTabs}>
            {fetchingTabs ? "Fetching…" : "Fetch tabs"}
          </button>
        </div>
        <p className="small muted" style={{ marginTop: 4 }}>
          {sheetTabs.length > 0 ? "Picked from the real tabs in this spreadsheet." : "Click \"Fetch tabs\" to pick from the real tab names instead of typing one."}
        </p>
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}gscells`}>Cell range (optional)</label>
        <input id={`${idPrefix}gscells`} value={cellRange} onChange={(e) => onCellRangeChange(e.target.value)} placeholder="e.g. A1:Z — leave blank for the whole sheet" />
      </div>
    </div>
  );
}

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
  const { pid, project, sources, loadingProject, refreshProjectData } = useWorkspace();
  const orgId = project?.org_id ?? null;
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState<SourceType>("google_sheets");
  const [path, setPath] = useState("");
  const [table, setTable] = useState("");
  const [googleConnectionId, setGoogleConnectionId] = useState("");
  const [spreadsheetId, setSpreadsheetId] = useState("");
  const [sheetFiles, setSheetFiles] = useState<{ id: string; name: string }[]>([]);
  const [fetchingFiles, setFetchingFiles] = useState(false);
  const [sheetName, setSheetName] = useState("Sheet1");
  const [cellRange, setCellRange] = useState("");
  const [mode, setMode] = useState("Hourly");
  const [saving, setSaving] = useState(false);
  const [sheetTabs, setSheetTabs] = useState<string[]>([]);
  const [fetchingTabs, setFetchingTabs] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ sourceId: string; token: string } | null>(null);
  const [connections, setConnections] = useState<ConnectionRow[]>([]);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [viewingArchivedId, setViewingArchivedId] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [columnFilters, setColumnFilters] = useState<Record<ColumnKey, string>>(EMPTY_FILTERS);
  const [sort, setSort] = useState<{ key: ColumnKey; dir: "asc" | "desc" }[]>([]);

  async function refreshConnections() {
    if (!orgId) return;
    const data = await apiFetch<ConnectionRow[]>(`/v1/orgs/${orgId}/connections`);
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
  }, [orgId]);

  const onedriveConn = connections.find((c) => c.kind === "onedrive" && c.status === "connected");
  // A project can have several connected Google accounts (one per Google
  // account) — unlike every other connection kind, which stays single.
  const googleConnections = connections.filter((c) => c.kind === "google_sheets" && c.status === "connected");

  function sourceAccountLabel(s: LeadSourceRow): string {
    if (s.type === "google_sheets") {
      const conn = connections.find((c) => c.id === s.provider_connection_id);
      return conn?.account_label ?? "—";
    }
    if (s.type === "onedrive") {
      return onedriveConn?.account_label ?? "—";
    }
    return "—";
  }

  async function startOAuth(provider: "onedrive" | "google_sheets") {
    if (!orgId) return;
    setError(null);
    try {
      const { url } = await apiFetch<{ url: string }>(`/v1/orgs/${orgId}/connections/oauth/${provider}/start`, { method: "POST" });
      window.location.href = url;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't start OAuth flow");
    }
  }

  async function addSource() {
    if (!pid || !name.trim()) return;
    setError(null);
    const config: Record<string, unknown> =
      type === "onedrive" ? { path, table } : type === "google_sheets" ? { spreadsheetId, range: joinSheetRange(sheetName, cellRange) } : {};
    setSaving(true);
    try {
      await apiFetch(`/v1/projects/${pid}/sources`, {
        method: "POST",
        body: JSON.stringify({
          name,
          type,
          config,
          mode: type === "onedrive" || type === "google_sheets" ? mode : null,
          provider_connection_id: type === "google_sheets" ? googleConnectionId : null,
        }),
      });
      setName("");
      setPath("");
      setTable("");
      setGoogleConnectionId("");
      setSpreadsheetId("");
      setSheetFiles([]);
      setSheetTabs([]);
      setAdding(false);
      await refreshProjectData();
    } catch (e) {
      setError(e instanceof ApiError && e.status === 403 ? "You have view-only access and can't add sources." : "Couldn't add source");
    } finally {
      setSaving(false);
    }
  }

  function startEdit(s: LeadSourceRow) {
    setAdding(false);
    setError(null);
    setEditingId(s.id);
    setName(s.name);
    setType(s.type as SourceType);
    setMode(s.mode || "Hourly");
    setPath(s.config?.path ?? "");
    setTable(s.config?.table ?? "");
    setGoogleConnectionId(s.provider_connection_id ?? "");
    setSpreadsheetId(s.config?.spreadsheetId ?? "");
    setSheetFiles([]);
    const { sheetName: sn, cellRange: cr } = splitSheetRange(s.config?.range ?? "Sheet1");
    setSheetName(sn);
    setCellRange(cr);
    setSheetTabs([]);
  }

  async function fetchSheetFiles() {
    if (!pid || !googleConnectionId) return;
    setFetchingFiles(true);
    setError(null);
    try {
      const { files } = await apiFetch<{ files: { id: string; name: string }[] }>(
        `/v1/projects/${pid}/sources/google-sheets/files?connectionId=${encodeURIComponent(googleConnectionId)}`
      );
      setSheetFiles(files);
      if (files.length) setSpreadsheetId(files[0].id);
      else setError("No Google Sheets found in that account's Drive.");
    } catch (e) {
      setSheetFiles([]);
      setError(e instanceof ApiError ? e.message : "Couldn't list that account's spreadsheets.");
    } finally {
      setFetchingFiles(false);
    }
  }

  async function fetchTabs() {
    if (!pid || !googleConnectionId || !spreadsheetId.trim()) return;
    setFetchingTabs(true);
    setError(null);
    try {
      const { tabs } = await apiFetch<{ tabs: string[] }>(
        `/v1/projects/${pid}/sources/google-sheets/tabs?spreadsheetId=${encodeURIComponent(spreadsheetId.trim())}&connectionId=${encodeURIComponent(googleConnectionId)}`
      );
      setSheetTabs(tabs);
      if (tabs.length) setSheetName(tabs[0]);
      else setError("That spreadsheet has no tabs, or isn't accessible from the connected Google Sheets account.");
    } catch (e) {
      setSheetTabs([]);
      setError(e instanceof ApiError ? e.message : "Couldn't read that spreadsheet's tabs.");
    } finally {
      setFetchingTabs(false);
    }
  }

  function cancelEdit() {
    setEditingId(null);
    setSheetFiles([]);
    setSheetTabs([]);
    setError(null);
  }

  async function saveEdit() {
    if (!pid || !editingId || !name.trim()) return;
    setError(null);
    const config: Record<string, unknown> | undefined =
      type === "onedrive" ? { path, table } : type === "google_sheets" ? { spreadsheetId, range: joinSheetRange(sheetName, cellRange) } : undefined;
    setSaving(true);
    try {
      await apiFetch(`/v1/projects/${pid}/sources/${editingId}`, {
        method: "PATCH",
        body: JSON.stringify({
          name,
          mode: type === "onedrive" || type === "google_sheets" ? mode : null,
          provider_connection_id: type === "google_sheets" ? googleConnectionId : undefined,
          ...(config ? { config } : {}),
        }),
      });
      setEditingId(null);
      await refreshProjectData();
    } catch (e) {
      setError(e instanceof ApiError && e.status === 403 ? "You have view-only access and can't edit sources." : "Couldn't save changes");
    } finally {
      setSaving(false);
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

  async function togglePaused(s: LeadSourceRow) {
    setError(null);
    setBusyId(s.id);
    try {
      await apiFetch(`/v1/projects/${pid}/sources/${s.id}`, { method: "PATCH", body: JSON.stringify({ paused: !s.paused }) });
      await refreshProjectData();
    } catch {
      setError(s.paused ? "Couldn't resume that source" : "Couldn't pause that source");
    } finally {
      setBusyId(null);
    }
  }

  async function toggleArchived(s: LeadSourceRow) {
    setError(null);
    setBusyId(s.id);
    try {
      await apiFetch(`/v1/projects/${pid}/sources/${s.id}`, {
        method: "PATCH",
        body: JSON.stringify({ archived_at: s.archived_at ? null : new Date().toISOString() }),
      });
      await refreshProjectData();
    } catch {
      setError(s.archived_at ? "Couldn't restore that source" : "Couldn't archive that source");
    } finally {
      setBusyId(null);
    }
  }

  async function deleteSourcePermanently(s: LeadSourceRow) {
    if (!confirm(`Permanently delete "${s.name}"? This can't be undone — its config and import history will be gone for good.`)) return;
    setError(null);
    setBusyId(s.id);
    try {
      await apiFetch(`/v1/projects/${pid}/sources/${s.id}`, { method: "DELETE" });
      setViewingArchivedId(null);
      await refreshProjectData();
    } catch {
      setError("Couldn't delete that source");
    } finally {
      setBusyId(null);
    }
  }

  const activeSources = useMemo(() => sources.filter((s) => !s.archived_at), [sources]);
  const archivedSources = useMemo(() => sources.filter((s) => s.archived_at), [sources]);

  const typeOptions = useMemo(() => Array.from(new Set(activeSources.map((s) => TYPE_LABEL[s.type as SourceType] ?? s.type))).sort(), [activeSources]);
  const modeOptions = useMemo(() => Array.from(new Set(activeSources.map((s) => (s.paused ? "Paused" : s.mode || "Manual")))).sort(), [activeSources]);

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
    let rows = activeSources.filter((s) => {
      if (columnFilters.name && !s.name.toLowerCase().includes(columnFilters.name.toLowerCase())) return false;
      if (columnFilters.type && (TYPE_LABEL[s.type as SourceType] ?? s.type) !== columnFilters.type) return false;
      if (columnFilters.mode && (s.paused ? "Paused" : s.mode || "Manual") !== columnFilters.mode) return false;
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
  }, [activeSources, search, columnFilters, sort]);

  return (
    <>
      <div className="top">
        <div>
          <h1>Lead sources</h1>
          <p>Webhook, website-form, OneDrive, and Google Sheets intake are live. CRM sync (Zoho/HubSpot) isn&apos;t built yet.</p>
        </div>
        <div className="row">
          <Button
            onClick={() => {
              setAdding((v) => !v);
              setEditingId(null);
              setGoogleConnectionId("");
              setSheetFiles([]);
              setSheetTabs([]);
              setError(null);
            }}
          >
            <Plus className="h-4 w-4" />
            Add source
          </Button>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <h3>Connect a sheet/workbook account</h3>
        <p className="small muted">
          Required once per project before adding a OneDrive or Google Sheets source. Connect more than one Google account if your
          sheets live in different Drives — each source then picks which account to sync through.
        </p>
        <div className="grid g2" style={{ marginTop: 14, gap: 24 }}>
          <div>
            <p className="small muted" style={{ marginBottom: 6, fontWeight: 600 }}>Connected OneDrive account</p>
            {onedriveConn ? (
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <span className="pill ok">{onedriveConn.account_label ?? "Connected account (reconnect to show its email)"}</span>
              </div>
            ) : (
              <p className="small muted">No OneDrive account connected yet.</p>
            )}
            <button className="btn" style={{ marginTop: 10 }} onClick={() => startOAuth("onedrive")}>
              {onedriveConn ? "Reconnect OneDrive" : "Connect a OneDrive account"}
            </button>
            <p className="small muted" style={{ marginTop: 4 }}>
              Only one OneDrive account per project — reconnecting replaces it in place.
            </p>
          </div>

          <div>
            <p className="small muted" style={{ marginBottom: 6, fontWeight: 600 }}>Connected Google accounts</p>
            {googleConnections.length ? (
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                {googleConnections.map((c) => (
                  <span key={c.id} className="pill ok">
                    {c.account_label ?? "Connected account (reconnect to show its email)"}
                  </span>
                ))}
              </div>
            ) : (
              <p className="small muted">No Google accounts connected yet.</p>
            )}
            <button className="btn" style={{ marginTop: 10 }} onClick={() => startOAuth("google_sheets")}>
              {googleConnections.length ? "Connect another Google account" : "Connect a Google account"}
            </button>
            <p className="small muted" style={{ marginTop: 4 }}>
              Reconnecting an account you&apos;ve already added refreshes it in place — it never creates a duplicate entry.
            </p>
          </div>
        </div>
      </div>

      {adding && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="grid g3">
            <div className="field">
              <label htmlFor="st">Type</label>
              <select id="st" value={type} onChange={(e) => setType(e.target.value as SourceType)}>
                <option value="google_sheets">Google Sheets</option>
                <option value="onedrive">OneDrive (Excel table)</option>
                <option value="webhook">Webhook</option>
                <option value="form">Website form</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="sn">Name</label>
              <input id="sn" value={name} onChange={(e) => setName(e.target.value)} placeholder="Website contact form" />
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
            <GoogleSheetsFields
              idPrefix=""
              googleConnections={googleConnections}
              googleConnectionId={googleConnectionId}
              spreadsheetId={spreadsheetId}
              sheetFiles={sheetFiles}
              fetchingFiles={fetchingFiles}
              sheetName={sheetName}
              cellRange={cellRange}
              sheetTabs={sheetTabs}
              fetchingTabs={fetchingTabs}
              onGoogleConnectionChange={(v) => {
                setGoogleConnectionId(v);
                setSpreadsheetId("");
                setSheetFiles([]);
                setSheetTabs([]);
              }}
              onFetchFiles={fetchSheetFiles}
              onSpreadsheetIdChange={(v) => {
                setSpreadsheetId(v);
                setSheetTabs([]);
              }}
              onSheetNameChange={setSheetName}
              onCellRangeChange={setCellRange}
              onFetchTabs={fetchTabs}
            />
          )}
          {type === "onedrive" && !onedriveConn && (
            <p className="small" style={{ color: "var(--bad)", marginTop: 10 }}>
              Connect a OneDrive account above first.
            </p>
          )}
          {type === "google_sheets" && !googleConnections.length && (
            <p className="small" style={{ color: "var(--bad)", marginTop: 10 }}>
              Connect a Google account above first.
            </p>
          )}

          <button
            className="btn primary"
            style={{ marginTop: 10 }}
            onClick={addSource}
            disabled={
              saving ||
              !name.trim() ||
              (type === "onedrive" && (!onedriveConn || !path.trim() || !table.trim())) ||
              (type === "google_sheets" && (!googleConnectionId || !spreadsheetId.trim() || !sheetName.trim()))
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

      {editingId && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <h3>Edit source</h3>
          <div className="grid g3">
            <div className="field">
              <label>Type</label>
              <input value={TYPE_LABEL[type] ?? type} disabled />
            </div>
            <div className="field">
              <label htmlFor="esn">Name</label>
              <input id="esn" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            {(type === "onedrive" || type === "google_sheets") && (
              <div className="field">
                <label htmlFor="esmode">Sync frequency</label>
                <select id="esmode" value={mode} onChange={(e) => setMode(e.target.value)}>
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
                <label htmlFor="eodpath">Workbook path</label>
                <input id="eodpath" value={path} onChange={(e) => setPath(e.target.value)} placeholder="/Leads/Master_Leads.xlsx" />
              </div>
              <div className="field">
                <label htmlFor="eodtable">Table name</label>
                <input id="eodtable" value={table} onChange={(e) => setTable(e.target.value)} placeholder="Table1" />
              </div>
            </div>
          )}
          {type === "google_sheets" && (
            <GoogleSheetsFields
              idPrefix="e"
              googleConnections={googleConnections}
              googleConnectionId={googleConnectionId}
              spreadsheetId={spreadsheetId}
              sheetFiles={sheetFiles}
              fetchingFiles={fetchingFiles}
              sheetName={sheetName}
              cellRange={cellRange}
              sheetTabs={sheetTabs}
              fetchingTabs={fetchingTabs}
              onGoogleConnectionChange={(v) => {
                setGoogleConnectionId(v);
                setSpreadsheetId("");
                setSheetFiles([]);
                setSheetTabs([]);
              }}
              onFetchFiles={fetchSheetFiles}
              onSpreadsheetIdChange={(v) => {
                setSpreadsheetId(v);
                setSheetTabs([]);
              }}
              onSheetNameChange={setSheetName}
              onCellRangeChange={setCellRange}
              onFetchTabs={fetchTabs}
            />
          )}

          <div className="row" style={{ marginTop: 10, gap: 10 }}>
            <button
              className="btn primary"
              onClick={saveEdit}
              disabled={
                saving ||
                !name.trim() ||
                (type === "onedrive" && (!path.trim() || !table.trim())) ||
                (type === "google_sheets" && (!googleConnectionId || !spreadsheetId.trim() || !sheetName.trim()))
              }
            >
              Save changes
            </button>
            <button className="btn" onClick={cancelEdit} disabled={saving}>
              Cancel
            </button>
          </div>
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
              {filteredSources.length} of {activeSources.length} sources — use the ⋮ menu on a column to sort or filter it.
            </p>
          </div>

          {archivedSources.length > 0 && (
            <Button variant="secondary" size="sm" className="self-start border-2 border-amber-400/60 bg-amber-100/60 text-amber-900 hover:bg-amber-100 dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-300 dark:hover:bg-amber-400/20" onClick={() => setShowArchived((v) => !v)}>
              <Archive className="h-3.5 w-3.5" />
              {showArchived ? "Hide" : "Show"} archived ({archivedSources.length})
            </Button>
          )}

          {showArchived && archivedSources.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Archived</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {archivedSources.map((s) => (
                  <Fragment key={s.id}>
                    <TableRow className="opacity-60">
                      <TableCell className="font-semibold text-foreground">{s.name}</TableCell>
                      <TableCell className="text-muted-foreground">{TYPE_LABEL[s.type as SourceType] ?? s.type}</TableCell>
                      <TableCell className="text-muted-foreground">{sourceAccountLabel(s)}</TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{s.archived_at ? new Date(s.archived_at).toLocaleString() : "—"}</TableCell>
                      <TableCell>
                        <Button variant="outline" size="sm" onClick={() => setViewingArchivedId((v) => (v === s.id ? null : s.id))}>
                          {viewingArchivedId === s.id ? "Hide details" : "View"}
                        </Button>
                      </TableCell>
                    </TableRow>
                    {viewingArchivedId === s.id && (
                      <TableRow key={`${s.id}-detail`}>
                        <TableCell colSpan={5} className="bg-muted/30">
                          <div className="flex flex-col gap-2 py-1 text-sm">
                            <p>
                              <span className="font-semibold text-foreground">Config: </span>
                              <span className="text-muted-foreground">{describeSourceConfig(s)}</span>
                            </p>
                            {(s.type === "onedrive" || s.type === "google_sheets") && (
                              <p>
                                <span className="font-semibold text-foreground">Sync frequency: </span>
                                <span className="text-muted-foreground">{s.paused ? "Paused" : s.mode || "Manual"}</span>
                              </p>
                            )}
                            <p>
                              <span className="font-semibold text-foreground">Last sync: </span>
                              <span className="text-muted-foreground">{s.last_sync ? new Date(s.last_sync).toLocaleString() : "Never"}</span>
                            </p>
                            <p>
                              <span className="font-semibold text-foreground">Leads imported: </span>
                              <span className="text-muted-foreground">
                                {s.rows_added} added · {s.rows_skipped} skipped · {s.rows_failed} failed
                              </span>
                            </p>
                            <div className="flex gap-2 pt-1">
                              <Button variant="outline" size="sm" disabled={busyId === s.id} onClick={() => toggleArchived(s)}>
                                <ArchiveRestore className="h-3.5 w-3.5" />
                                Restore
                              </Button>
                              <Button variant="destructive" size="sm" disabled={busyId === s.id} onClick={() => deleteSourcePermanently(s)}>
                                <Trash2 className="h-3.5 w-3.5" />
                                Delete permanently
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => setViewingArchivedId(null)}>
                                Close
                              </Button>
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          )}

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
                <TableHead>Account</TableHead>
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
                  <TableCell className="text-muted-foreground">{sourceAccountLabel(s)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {s.paused ? <span className="pill warn">Paused</span> : s.mode || "Manual"}
                  </TableCell>
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
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" onClick={() => startEdit(s)}>
                        <Pencil className="h-3.5 w-3.5" />
                        Edit
                      </Button>
                      {(s.type === "webhook" || s.type === "form") && (
                        <Button variant="outline" size="sm" onClick={() => generateToken(s.id)}>
                          {s.last_sync ? "Rotate token" : "Generate token"}
                        </Button>
                      )}
                      {(s.type === "onedrive" || s.type === "google_sheets") && (
                        <>
                          <Button variant="outline" size="sm" disabled={syncingId === s.id} onClick={() => syncNow(s.id)}>
                            {syncingId === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                            {syncingId === s.id ? "Syncing…" : "Sync now"}
                          </Button>
                          <Button variant="outline" size="sm" disabled={busyId === s.id} onClick={() => togglePaused(s)}>
                            {s.paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                            {s.paused ? "Resume" : "Pause"}
                          </Button>
                        </>
                      )}
                      <Button variant="outline" size="sm" disabled={busyId === s.id} onClick={() => toggleArchived(s)}>
                        <Archive className="h-3.5 w-3.5" />
                        Archive
                      </Button>
                    </div>
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
