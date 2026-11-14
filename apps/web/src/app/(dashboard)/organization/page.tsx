"use client";
import { useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, Gauge, Inbox, Mail, MessageCircle, Pencil, Plus, Sparkles } from "lucide-react";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { apiFetch, ApiError } from "@/lib/apiClient";
import { createClient } from "@/lib/supabase/client";
import { PROVIDERS, providerInfo, type ProviderInfo } from "@/lib/providerCatalog";
import type { ConnectionRow, OrganizationRow } from "@/lib/types";
import { TeamSettings } from "@/components/TeamSettings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

const STATUS_LABEL: Record<string, string> = {
  connected: "Connected",
  needs_reconnect: "Needs reconnect",
  disconnected: "Not connected",
};
const STATUS_VARIANT: Record<string, "success" | "destructive" | "secondary"> = {
  connected: "success",
  needs_reconnect: "destructive",
  disconnected: "secondary",
};
// GREEN/YELLOW/RED/NA/UNKNOWN per Meta's Graph API quality_rating enum —
// confirmed field values, not guessed. NA/UNKNOWN both render neutral since
// neither means "bad," just "not yet determined."
const QUALITY_VARIANT: Record<string, "success" | "destructive" | "secondary"> = {
  GREEN: "success",
  YELLOW: "secondary",
  RED: "destructive",
  NA: "secondary",
  UNKNOWN: "secondary",
};
function messagingTierLabel(tier: string): string {
  // "TIER_250" -> "250/day", "TIER_UNLIMITED" -> "Unlimited/day"
  const n = tier.replace("TIER_", "");
  return n === "UNLIMITED" || n === "NOT_SET" ? (n === "UNLIMITED" ? "Unlimited/day" : "Not set") : `${n}/day`;
}
// Mirrors apps/worker/src/rateLimit.ts / apps/api/src/rateLimit.ts's
// DEFAULT_LIMITS — display-only, so a connection with no explicit override
// shows the real default it's getting instead of looking falsely unlimited.
const DEFAULT_RATE_LIMITS: Partial<Record<string, number>> = { "360messenger": 10 };
function rateLimitLabel(conn: ConnectionRow): string {
  if (conn.max_sends_per_minute != null) return `${conn.max_sends_per_minute}/min`;
  const def = DEFAULT_RATE_LIMITS[conn.provider];
  return def ? `${def}/min (default)` : "Unlimited";
}
const KIND_META = {
  email: { title: "Email", icon: Mail },
  whatsapp: { title: "WhatsApp", icon: MessageCircle },
  email_imap: { title: "Email replies (IMAP)", icon: Inbox },
  ai: { title: "AI (template generation & rewrite)", icon: Sparkles },
} as const;

export default function OrganizationPage() {
  const { project } = useWorkspace();
  // Connections (and Team, rendered below) are shared across every project
  // in the org (migration 0041_connections_org_scoped.sql), so this page
  // keys off the current project's org, not the project itself.
  const orgId = project?.org_id ?? null;

  const [org, setOrg] = useState<OrganizationRow | null>(null);
  const [editingOrgName, setEditingOrgName] = useState(false);
  const [orgNameValue, setOrgNameValue] = useState("");
  const [orgNameBusy, setOrgNameBusy] = useState(false);
  const [orgNameError, setOrgNameError] = useState<string | null>(null);
  const [connections, setConnections] = useState<ConnectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<string | null>(null);
  const [adding, setAdding] = useState<ProviderInfo | null>(null);
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [pendingProvider, setPendingProvider] = useState<Record<string, string>>({});
  // Which section's "+" was clicked — opens the provider-picker popup
  // instead of the old always-visible sidebar column.
  const [pickingProviderKind, setPickingProviderKind] = useState<"email" | "whatsapp" | "email_imap" | "ai" | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  // Test-send dialog — lets the user actually exercise a connection (real
  // email / real WhatsApp message to an address/number they choose) instead
  // of just the credential-only /test check, since a valid API key doesn't
  // guarantee delivery actually works end to end.
  const [testing, setTesting] = useState<ConnectionRow | null>(null);
  const [emailTestForm, setEmailTestForm] = useState({ to: "", cc: "", subject: "", body: "", from: "" });
  const [waTestForm, setWaTestForm] = useState({ to: "", message: "" });
  const [testBusy, setTestBusy] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [testSuccess, setTestSuccess] = useState<string | null>(null);

  // Rate-limit override editor — a plain column, not a credential, so it's
  // a separate tiny dialog rather than folded into the add/test ones above.
  const [editingRateLimit, setEditingRateLimit] = useState<ConnectionRow | null>(null);
  const [rateLimitValue, setRateLimitValue] = useState("");
  const [rateLimitBusy, setRateLimitBusy] = useState(false);
  const [rateLimitError, setRateLimitError] = useState<string | null>(null);

  // Only meaningful for API-key email providers (Resend/SES/SendGrid/Brevo/
  // SMTP) — their "from" is caller-controlled per send, so this connection's
  // verified domain can send as any address in the list. One per line.
  const [editingFromAddresses, setEditingFromAddresses] = useState<ConnectionRow | null>(null);
  const [fromAddressesValue, setFromAddressesValue] = useState("");
  // Which of those addresses a template falls back to when it hasn't picked
  // one itself — without this, that fallback silently used whatever address
  // was typed once at connect time and never shown again (see
  // emailWorker.ts's fromEmail precedence).
  const [defaultFromAddressValue, setDefaultFromAddressValue] = useState("");
  const [fromAddressesBusy, setFromAddressesBusy] = useState(false);
  const [fromAddressesError, setFromAddressesError] = useState<string | null>(null);

  useEffect(() => {
    createClient()
      .auth.getUser()
      .then(({ data }) => setUserEmail(data.user?.email ?? null));
  }, []);

  useEffect(() => {
    if (!orgId) return;
    apiFetch<OrganizationRow>(`/v1/orgs/${orgId}`)
      .then(setOrg)
      .catch(() => setOrg(null));
  }, [orgId]);

  function startEditingOrgName() {
    setOrgNameValue(org?.name ?? "");
    setOrgNameError(null);
    setEditingOrgName(true);
  }

  async function saveOrgName() {
    if (!orgId || !orgNameValue.trim()) return;
    setOrgNameBusy(true);
    setOrgNameError(null);
    try {
      const updated = await apiFetch<OrganizationRow>(`/v1/orgs/${orgId}`, {
        method: "PATCH",
        body: JSON.stringify({ name: orgNameValue.trim() }),
      });
      setOrg(updated);
      setEditingOrgName(false);
    } catch (e) {
      setOrgNameError(e instanceof ApiError && e.status === 404 ? "You need admin access to rename this organization." : "Couldn't save.");
    } finally {
      setOrgNameBusy(false);
    }
  }

  async function refresh() {
    if (!orgId) return;
    setLoading(true);
    try {
      const data = await apiFetch<ConnectionRow[]>(`/v1/orgs/${orgId}/connections`);
      setConnections(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("oauth_connected");
    const oauthError = params.get("oauth_error");
    if (connected) {
      setBanner(`Connected ${connected === "gmail" ? "Gmail" : "Microsoft 365"}.`);
      refresh();
    } else if (oauthError) {
      setBanner(`Connection failed: ${oauthError.replace(/_/g, " ")}.`);
    }
    if (connected || oauthError) {
      window.history.replaceState({}, "", window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startOAuth(provider: ProviderInfo) {
    if (!orgId) return;
    setError(null);
    try {
      const { url } = await apiFetch<{ url: string }>(`/v1/orgs/${orgId}/connections/oauth/${provider.id}/start`, {
        method: "POST",
      });
      window.location.href = url;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't start OAuth flow");
    }
  }

  async function createConnection() {
    if (!orgId || !adding) return;
    setError(null);
    setConnecting(true);
    try {
      await apiFetch(`/v1/orgs/${orgId}/connections`, {
        method: "POST",
        body: JSON.stringify({ kind: adding.kind, provider: adding.id, credentials }),
      });
      setAdding(null);
      setCredentials({});
      await refresh();
    } catch (e) {
      setError(e instanceof ApiError && e.status === 403 ? "You need admin access to connect providers." : e instanceof Error ? e.message : "Couldn't connect");
    } finally {
      setConnecting(false);
    }
  }

  async function testConnection(conn: ConnectionRow, otherConnected?: ConnectionRow) {
    if (!orgId) return;
    if (
      otherConnected &&
      !confirm(
        `This will make ${providerInfo(conn.provider)?.label ?? conn.provider} the active ${conn.kind} connection for this organization, replacing ${
          providerInfo(otherConnected.provider)?.label ?? otherConnected.provider
        }. Continue?`
      )
    ) {
      return;
    }
    setBusyId(conn.id);
    setError(null);
    try {
      await apiFetch(`/v1/orgs/${orgId}/connections/${conn.id}/test`, { method: "POST" });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Test failed");
    } finally {
      setBusyId(null);
    }
  }

  // AI connections have nothing meaningful to send a test message to — keep
  // their Test button on the plain credential check. Email/WhatsApp open a
  // dialog that actually sends something real, prefilled from this project's
  // settings (email/WhatsApp number) so there's nothing to type for a quick check.
  function openTestDialog(conn: ConnectionRow, otherConnected?: ConnectionRow) {
    // AI and the IMAP reply inbox have nothing meaningful to send a test
    // message to — keep their Test button on the plain credential check.
    if (conn.kind === "ai" || conn.kind === "email_imap") {
      testConnection(conn, conn.kind === "email_imap" ? otherConnected : undefined);
      return;
    }
    if (
      otherConnected &&
      !confirm(
        `This will make ${providerInfo(conn.provider)?.label ?? conn.provider} the active ${conn.kind} connection for this organization, replacing ${
          providerInfo(otherConnected.provider)?.label ?? otherConnected.provider
        }. Continue?`
      )
    ) {
      return;
    }
    setError(null);
    setTestError(null);
    setTestSuccess(null);
    const brandName = project?.brand || project?.name || "our team";
    const providerLabel = providerInfo(conn.provider)?.label ?? conn.provider;
    if (conn.kind === "email") {
      setEmailTestForm({
        // Project settings' own Email field is the intended default — it's
        // what the admin set up specifically for this — falling back to the
        // signed-in user's email only when the project has none set yet.
        to: project?.email || userEmail || "",
        cc: "",
        subject: `Test email from ${brandName}`,
        body: `This is a test email from ${brandName}, sent via ${providerLabel} to confirm the connection is working correctly.`,
        // Prefer the connection's chosen default address; otherwise its
        // first configured address; otherwise leave blank so the backend
        // falls back to the connection's own account_label/credential default.
        from: conn.default_from_address || conn.from_addresses?.[0] || "",
      });
    } else {
      setWaTestForm({
        to: project?.wa_number || "",
        message: `Hello! This is a test message from ${brandName}, sent via ${providerLabel} to confirm the WhatsApp connection is working correctly.`,
      });
    }
    setTesting(conn);
  }

  function closeTestDialog() {
    if (testBusy) return;
    setTesting(null);
    setTestError(null);
    setTestSuccess(null);
  }

  async function submitEmailTest() {
    if (!orgId || !testing) return;
    setTestBusy(true);
    setTestError(null);
    setTestSuccess(null);
    try {
      await apiFetch(`/v1/orgs/${orgId}/connections/${testing.id}/test-send-email`, {
        method: "POST",
        body: JSON.stringify({
          to: emailTestForm.to,
          cc: emailTestForm.cc || undefined,
          subject: emailTestForm.subject,
          body: emailTestForm.body,
          from: emailTestForm.from || undefined,
        }),
      });
      setTestSuccess(`Test email sent to ${emailTestForm.to}.`);
      await refresh();
    } catch (e) {
      setTestError(e instanceof ApiError ? e.message : "Couldn't send test email.");
    } finally {
      setTestBusy(false);
    }
  }

  async function submitWaTest() {
    if (!orgId || !testing) return;
    setTestBusy(true);
    setTestError(null);
    setTestSuccess(null);
    try {
      await apiFetch(`/v1/orgs/${orgId}/connections/${testing.id}/test-send-whatsapp`, {
        method: "POST",
        body: JSON.stringify({ to: waTestForm.to, message: waTestForm.message }),
      });
      setTestSuccess(`Test message sent to ${waTestForm.to}.`);
      await refresh();
    } catch (e) {
      setTestError(e instanceof ApiError ? e.message : "Couldn't send test message.");
    } finally {
      setTestBusy(false);
    }
  }

  function openRateLimitEditor(conn: ConnectionRow) {
    setEditingRateLimit(conn);
    setRateLimitValue(conn.max_sends_per_minute != null ? String(conn.max_sends_per_minute) : "");
    setRateLimitError(null);
  }

  async function saveRateLimit() {
    if (!orgId || !editingRateLimit) return;
    setRateLimitBusy(true);
    setRateLimitError(null);
    try {
      const trimmed = rateLimitValue.trim();
      await apiFetch(`/v1/orgs/${orgId}/connections/${editingRateLimit.id}/rate-limit`, {
        method: "PATCH",
        body: JSON.stringify({ maxSendsPerMinute: trimmed ? Number(trimmed) : null }),
      });
      setEditingRateLimit(null);
      await refresh();
    } catch (e) {
      setRateLimitError(e instanceof ApiError && e.status === 403 ? "You need admin access to change this." : "Couldn't save.");
    } finally {
      setRateLimitBusy(false);
    }
  }

  function openFromAddressesEditor(conn: ConnectionRow) {
    setEditingFromAddresses(conn);
    setFromAddressesValue((conn.from_addresses ?? []).join("\n"));
    setDefaultFromAddressValue(conn.default_from_address ?? "");
    setFromAddressesError(null);
  }

  // Live-parsed from the textarea so the default picker's options always
  // match what's about to be saved, not the last-saved list.
  function parsedFromAddresses(): string[] {
    return fromAddressesValue
      .split("\n")
      .map((v) => v.trim())
      .filter(Boolean);
  }

  async function saveFromAddresses() {
    if (!orgId || !editingFromAddresses) return;
    setFromAddressesBusy(true);
    setFromAddressesError(null);
    try {
      const fromAddresses = parsedFromAddresses();
      const defaultFromAddress = fromAddresses.includes(defaultFromAddressValue) ? defaultFromAddressValue : null;
      await apiFetch(`/v1/orgs/${orgId}/connections/${editingFromAddresses.id}/from-addresses`, {
        method: "PATCH",
        body: JSON.stringify({ fromAddresses, defaultFromAddress }),
      });
      setEditingFromAddresses(null);
      await refresh();
    } catch (e) {
      setFromAddressesError(
        e instanceof ApiError && e.status === 403
          ? "You need admin access to change this."
          : e instanceof ApiError
            ? e.message
            : "Couldn't save."
      );
    } finally {
      setFromAddressesBusy(false);
    }
  }

  async function disconnect(conn: ConnectionRow) {
    if (!orgId) return;
    if (!confirm(`Disconnect ${providerInfo(conn.provider)?.label ?? conn.provider}?`)) return;
    setBusyId(conn.id);
    setError(null);
    try {
      await apiFetch(`/v1/orgs/${orgId}/connections/${conn.id}`, { method: "DELETE" });
      await refresh();
    } catch (e) {
      setError(e instanceof ApiError && e.status === 403 ? "You need admin access to disconnect providers." : "Couldn't disconnect");
    } finally {
      setBusyId(null);
    }
  }

  function connectPending(kind: string) {
    const p = PROVIDERS.find((x) => x.id === pendingProvider[kind]);
    if (!p) return;
    setPickingProviderKind(null);
    if (p.auth === "oauth") startOAuth(p);
    else {
      setAdding(p);
      setCredentials({});
    }
  }

  const emailConns = connections.filter((c) => c.kind === "email");
  const waConns = connections.filter((c) => c.kind === "whatsapp");
  const emailImapConns = connections.filter((c) => c.kind === "email_imap");
  const aiConns = connections.filter((c) => c.kind === "ai");

  function section(kind: "email" | "whatsapp" | "email_imap" | "ai", conns: ConnectionRow[]) {
    const { title, icon: Icon } = KIND_META[kind];
    return (
      <Card key={kind} className="overflow-hidden">
        <CardHeader className="flex-row items-center gap-2 space-y-0 border-b border-border bg-muted/30 py-3.5">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-display text-base font-semibold text-foreground">{title}</h2>
          {conns.length > 0 && (
            <Badge variant="secondary" className="font-normal text-muted-foreground">
              {conns.length} connected
            </Badge>
          )}
          <button
            type="button"
            className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-full border border-border text-muted-foreground hover:border-primary hover:text-primary"
            onClick={() => setPickingProviderKind(kind)}
            title={`Add a ${title.toLowerCase()} provider`}
            aria-label={`Add a ${title.toLowerCase()} provider`}
          >
            <Plus className="h-4 w-4" />
          </button>
        </CardHeader>
        <CardContent className="p-0">
          <div className="flex flex-col justify-center p-5">
            {conns.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Provider</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead>Status</TableHead>
                    {kind === "whatsapp" && <TableHead>Quality</TableHead>}
                    {kind !== "ai" && kind !== "email_imap" && <TableHead>Rate limit</TableHead>}
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {conns.map((c) => {
                    // email/whatsapp no longer replace a sibling when
                    // connected — multiple can stay connected at once (each
                    // template picks its own From connection, see
                    // sequence/page.tsx).
                    const activeSibling =
                      kind !== "ai" && kind !== "email" && kind !== "whatsapp"
                        ? conns.find((other) => other.id !== c.id && other.status === "connected")
                        : undefined;
                    const willSwitchActive = c.status !== "connected" && !!activeSibling;
                    return (
                    <TableRow key={c.id}>
                      <TableCell className="font-semibold text-foreground">{providerInfo(c.provider)?.label ?? c.provider}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {c.account_label || "—"}
                        {c.connected_by_email && <div className="text-xs text-muted-foreground/70">Connected by {c.connected_by_email}</div>}
                        {c.default_from_address && (
                          <div className="text-xs text-muted-foreground/70" title="Used when a template doesn't pick a From address itself">
                            Default: {c.default_from_address}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant={STATUS_VARIANT[c.status]} className="gap-1" title={c.needs_reconnect_reason ?? undefined}>
                            {c.status === "connected" ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                            {STATUS_LABEL[c.status]}
                          </Badge>
                          {c.webhook_warning && (
                            <Badge variant="outline" className="gap-1 text-amber-600 border-amber-300" title={c.webhook_warning}>
                              <AlertTriangle className="h-3 w-3" />
                              Replies unavailable
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      {kind === "whatsapp" && (
                        <TableCell>
                          {c.provider === "meta" && (c.wa_quality_rating || c.wa_messaging_tier) ? (
                            <div
                              className="flex flex-wrap items-center gap-1.5"
                              title={c.wa_quality_checked_at ? `Last checked ${new Date(c.wa_quality_checked_at).toLocaleString()}` : undefined}
                            >
                              {c.wa_quality_rating && (
                                <Badge variant={QUALITY_VARIANT[c.wa_quality_rating] ?? "secondary"} className="font-semibold">
                                  {c.wa_quality_rating}
                                </Badge>
                              )}
                              {c.wa_messaging_tier && <span className="text-xs text-muted-foreground">{messagingTierLabel(c.wa_messaging_tier)}</span>}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      )}
                      {kind !== "ai" && kind !== "email_imap" && (
                        <TableCell>
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground hover:border-muted-foreground"
                            onClick={() => openRateLimitEditor(c)}
                            title="Set a max sends/minute override for this connection"
                          >
                            <Gauge className="h-3 w-3" />
                            {rateLimitLabel(c)}
                            <Pencil className="h-3 w-3 opacity-60" />
                          </button>
                        </TableCell>
                      )}
                      <TableCell>
                        <div className="flex justify-end gap-1.5">
                          {kind === "email" && providerInfo(c.provider)?.auth === "apikey" && (
                            <Button variant="outline" size="sm" onClick={() => openFromAddressesEditor(c)} title="Addresses this connection's verified domain can send as">
                              <Mail className="h-3.5 w-3.5" />
                              From addresses ({(c.from_addresses ?? []).length})
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busyId === c.id}
                            onClick={() => openTestDialog(c, activeSibling)}
                            title={willSwitchActive ? `Make this the active ${KIND_META[kind].title.toLowerCase()} connection` : undefined}
                          >
                            {busyId === c.id ? "…" : willSwitchActive ? "Make active" : "Test"}
                          </Button>
                          <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" disabled={busyId === c.id} onClick={() => disconnect(c)}>
                            Disconnect
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground">No {title.toLowerCase()} providers connected yet.</p>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-10">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Organization</p>
        {editingOrgName ? (
          <div className="flex items-center gap-2 pt-1">
            <Input
              autoFocus
              value={orgNameValue}
              onChange={(e) => setOrgNameValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveOrgName()}
              className="h-9 max-w-xs text-lg font-semibold"
            />
            <Button size="sm" onClick={saveOrgName} disabled={orgNameBusy || !orgNameValue.trim()}>
              {orgNameBusy ? "Saving…" : "Save"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditingOrgName(false)} disabled={orgNameBusy}>
              Cancel
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <h1 className="font-display text-2xl font-bold text-foreground">{org?.name ?? "…"}</h1>
            {org && (
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                onClick={startEditingOrgName}
                title="Rename organization"
                aria-label="Rename organization"
              >
                <Pencil className="h-4 w-4" />
              </button>
            )}
          </div>
        )}
        {orgNameError && <p className="text-sm text-destructive">{orgNameError}</p>}
      </div>

      <div className="flex flex-col gap-6">
        <div>
          <h2 className="font-display text-lg font-semibold text-foreground">Connections</h2>
          <p className="text-sm text-muted-foreground">
            Connect email, WhatsApp, AI, and other provider accounts — shared by every project in this organization. Credentials are
            encrypted at rest and never sent back to the browser.
          </p>
        </div>

      {banner && (
        <div
          className="cursor-pointer rounded-md border border-primary/30 bg-primary/5 px-4 py-2.5 text-sm text-foreground"
          onClick={() => setBanner(null)}
        >
          {banner}
        </div>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading connections…</p>
        ) : (
          <div className="flex flex-col gap-5">
            {section("email", emailConns)}
            {section("email_imap", emailImapConns)}
            {section("whatsapp", waConns)}
            {section("ai", aiConns)}
          </div>
        )}
      </div>

      {orgId && <TeamSettings orgId={orgId} orgName={org?.name ?? null} />}

      <Dialog open={!!pickingProviderKind} onOpenChange={(open) => !open && setPickingProviderKind(null)}>
        <DialogContent>
          {pickingProviderKind && (
            <>
              <DialogHeader>
                <DialogTitle>Add a {KIND_META[pickingProviderKind].title.toLowerCase()} provider</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="picker-provider">Provider</Label>
                <Select
                  id="picker-provider"
                  value={pendingProvider[pickingProviderKind] ?? ""}
                  onChange={(e) => setPendingProvider({ ...pendingProvider, [pickingProviderKind]: e.target.value })}
                >
                  <option value="">Choose a provider…</option>
                  {PROVIDERS.filter((p) => p.kind === pickingProviderKind).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </Select>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setPickingProviderKind(null)}>
                  Cancel
                </Button>
                <Button disabled={!pendingProvider[pickingProviderKind]} onClick={() => connectPending(pickingProviderKind)}>
                  {PROVIDERS.find((p) => p.id === pendingProvider[pickingProviderKind])?.auth === "oauth" ? (
                    <>
                      Continue <ArrowRight className="h-3.5 w-3.5" />
                    </>
                  ) : (
                    <>
                      <Plus className="h-3.5 w-3.5" />
                      Connect
                    </>
                  )}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!adding} onOpenChange={(open) => !open && setAdding(null)}>
        <DialogContent>
          {adding && (
            <>
              <DialogHeader>
                <DialogTitle>Connect {adding.label}</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col gap-3">
                {adding.fields.map((f) => (
                  <div key={f.key} className="flex flex-col gap-1.5">
                    <Label htmlFor={`f_${f.key}`}>{f.label}</Label>
                    <Input
                      id={`f_${f.key}`}
                      type={f.type === "password" ? "password" : "text"}
                      placeholder={f.placeholder}
                      value={credentials[f.key] ?? ""}
                      onChange={(e) => setCredentials({ ...credentials, [f.key]: e.target.value })}
                    />
                  </div>
                ))}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setAdding(null)}>
                  Cancel
                </Button>
                <Button onClick={createConnection} disabled={connecting}>
                  {connecting ? "Connecting…" : "Connect & test"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!testing} onOpenChange={(open) => !open && closeTestDialog()}>
        <DialogContent>
          {testing && testing.kind === "email" && (
            <>
              <DialogHeader>
                <DialogTitle>Send a test email</DialogTitle>
                <DialogDescription>
                  Sends a real email through {providerInfo(testing.provider)?.label ?? testing.provider} so you can confirm it&apos;s
                  actually working.
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-3">
                {!!testing.from_addresses?.length && (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="test-from">From</Label>
                    <Select
                      id="test-from"
                      value={emailTestForm.from}
                      onChange={(e) => setEmailTestForm({ ...emailTestForm, from: e.target.value })}
                    >
                      {testing.from_addresses.map((addr) => (
                        <option key={addr} value={addr}>
                          {addr}
                        </option>
                      ))}
                    </Select>
                  </div>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="test-to">To</Label>
                    <Input
                      id="test-to"
                      type="email"
                      value={emailTestForm.to}
                      onChange={(e) => setEmailTestForm({ ...emailTestForm, to: e.target.value })}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="test-cc">CC (optional)</Label>
                    <Input
                      id="test-cc"
                      type="email"
                      value={emailTestForm.cc}
                      onChange={(e) => setEmailTestForm({ ...emailTestForm, cc: e.target.value })}
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="test-subject">Subject</Label>
                  <Input
                    id="test-subject"
                    value={emailTestForm.subject}
                    onChange={(e) => setEmailTestForm({ ...emailTestForm, subject: e.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="test-body">Email body</Label>
                  <Textarea
                    id="test-body"
                    rows={4}
                    value={emailTestForm.body}
                    onChange={(e) => setEmailTestForm({ ...emailTestForm, body: e.target.value })}
                  />
                </div>
              </div>
              {testError && <p className="text-sm text-destructive">{testError}</p>}
              {testSuccess && <p className="text-sm text-success">{testSuccess}</p>}
              <DialogFooter>
                <Button variant="outline" onClick={closeTestDialog} disabled={testBusy}>
                  Cancel
                </Button>
                <Button
                  onClick={submitEmailTest}
                  disabled={testBusy || !emailTestForm.to.trim() || !emailTestForm.subject.trim() || !emailTestForm.body.trim()}
                >
                  {testBusy ? "Sending…" : "Send test email"}
                </Button>
              </DialogFooter>
            </>
          )}
          {testing && testing.kind === "whatsapp" && (
            <>
              <DialogHeader>
                <DialogTitle>Send a test WhatsApp message</DialogTitle>
                <DialogDescription>
                  Sends a real WhatsApp message through {providerInfo(testing.provider)?.label ?? testing.provider} so you can confirm
                  it&apos;s actually working.
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="test-wa-to">WhatsApp number</Label>
                  <Input
                    id="test-wa-to"
                    placeholder="e.g. 9876543210 or +91 98765 43210"
                    value={waTestForm.to}
                    onChange={(e) => setWaTestForm({ ...waTestForm, to: e.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="test-wa-msg">Message</Label>
                  <Textarea
                    id="test-wa-msg"
                    rows={4}
                    value={waTestForm.message}
                    onChange={(e) => setWaTestForm({ ...waTestForm, message: e.target.value })}
                  />
                </div>
              </div>
              {testError && <p className="text-sm text-destructive">{testError}</p>}
              {testSuccess && <p className="text-sm text-success">{testSuccess}</p>}
              <DialogFooter>
                <Button variant="outline" onClick={closeTestDialog} disabled={testBusy}>
                  Cancel
                </Button>
                <Button onClick={submitWaTest} disabled={testBusy || !waTestForm.to.trim() || !waTestForm.message.trim()}>
                  {testBusy ? "Sending…" : "Send test message"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingRateLimit} onOpenChange={(open) => !open && !rateLimitBusy && setEditingRateLimit(null)}>
        <DialogContent>
          {editingRateLimit && (
            <>
              <DialogHeader>
                <DialogTitle>Rate limit — {providerInfo(editingRateLimit.provider)?.label ?? editingRateLimit.provider}</DialogTitle>
                <DialogDescription>
                  Caps how fast sends go out through this connection, independent of the sequence&apos;s daily cap — a backstop against
                  tripping the provider&apos;s own abuse detection. Leave blank for{" "}
                  {DEFAULT_RATE_LIMITS[editingRateLimit.provider] ? `the default (${DEFAULT_RATE_LIMITS[editingRateLimit.provider]}/min)` : "unlimited"}.
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="rate-limit-value">Max sends per minute</Label>
                <Input
                  id="rate-limit-value"
                  type="number"
                  min={1}
                  max={10000}
                  placeholder="Unlimited"
                  value={rateLimitValue}
                  onChange={(e) => setRateLimitValue(e.target.value)}
                />
              </div>
              {rateLimitError && <p className="text-sm text-destructive">{rateLimitError}</p>}
              <DialogFooter>
                <Button variant="outline" onClick={() => setEditingRateLimit(null)} disabled={rateLimitBusy}>
                  Cancel
                </Button>
                <Button onClick={saveRateLimit} disabled={rateLimitBusy}>
                  {rateLimitBusy ? "Saving…" : "Save"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingFromAddresses} onOpenChange={(open) => !open && !fromAddressesBusy && setEditingFromAddresses(null)}>
        <DialogContent>
          {editingFromAddresses && (
            <>
              <DialogHeader>
                <DialogTitle>From addresses — {providerInfo(editingFromAddresses.provider)?.label ?? editingFromAddresses.provider}</DialogTitle>
                <DialogDescription>
                  Addresses this connection&apos;s verified domain can send as — each template picks one of these (or the connection
                  itself) as its From address. One per line.
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="from-addresses-value">Addresses</Label>
                <Textarea
                  id="from-addresses-value"
                  rows={5}
                  placeholder={"sales@yourdomain.com\ninfo@yourdomain.com"}
                  value={fromAddressesValue}
                  onChange={(e) => setFromAddressesValue(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="default-from-address">Default address</Label>
                <Select id="default-from-address" value={defaultFromAddressValue} onChange={(e) => setDefaultFromAddressValue(e.target.value)}>
                  <option value="">No default — fall back further</option>
                  {parsedFromAddresses().map((addr) => (
                    <option key={addr} value={addr}>
                      {addr}
                    </option>
                  ))}
                </Select>
                <p className="hint">Used for any template that hasn&apos;t picked a specific From address itself.</p>
              </div>
              {fromAddressesError && <p className="text-sm text-destructive">{fromAddressesError}</p>}
              <DialogFooter>
                <Button variant="outline" onClick={() => setEditingFromAddresses(null)} disabled={fromAddressesBusy}>
                  Cancel
                </Button>
                <Button onClick={saveFromAddresses} disabled={fromAddressesBusy}>
                  {fromAddressesBusy ? "Saving…" : "Save"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
