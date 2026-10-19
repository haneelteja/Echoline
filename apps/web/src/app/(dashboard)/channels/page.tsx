"use client";
import { useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, Mail, MessageCircle, Plus, Sparkles } from "lucide-react";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { apiFetch, ApiError } from "@/lib/apiClient";
import { createClient } from "@/lib/supabase/client";
import { PROVIDERS, providerInfo, type ProviderInfo } from "@/lib/providerCatalog";
import type { ConnectionRow } from "@/lib/types";
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
const KIND_META = {
  email: { title: "Email", icon: Mail },
  whatsapp: { title: "WhatsApp", icon: MessageCircle },
  ai: { title: "AI (template generation & rewrite)", icon: Sparkles },
} as const;

export default function ChannelsPage() {
  const { pid, project } = useWorkspace();

  const [connections, setConnections] = useState<ConnectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<string | null>(null);
  const [adding, setAdding] = useState<ProviderInfo | null>(null);
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [pendingProvider, setPendingProvider] = useState<Record<string, string>>({});
  const [userEmail, setUserEmail] = useState<string | null>(null);

  // Test-send dialog — lets the user actually exercise a connection (real
  // email / real WhatsApp message to an address/number they choose) instead
  // of just the credential-only /test check, since a valid API key doesn't
  // guarantee delivery actually works end to end.
  const [testing, setTesting] = useState<ConnectionRow | null>(null);
  const [emailTestForm, setEmailTestForm] = useState({ to: "", cc: "", subject: "", body: "" });
  const [waTestForm, setWaTestForm] = useState({ to: "", message: "" });
  const [testBusy, setTestBusy] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [testSuccess, setTestSuccess] = useState<string | null>(null);

  useEffect(() => {
    createClient()
      .auth.getUser()
      .then(({ data }) => setUserEmail(data.user?.email ?? null));
  }, []);

  async function refresh() {
    if (!pid) return;
    setLoading(true);
    try {
      const data = await apiFetch<ConnectionRow[]>(`/v1/projects/${pid}/connections`);
      setConnections(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid]);

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
    if (!pid) return;
    setError(null);
    try {
      const { url } = await apiFetch<{ url: string }>(`/v1/projects/${pid}/connections/oauth/${provider.id}/start`, {
        method: "POST",
      });
      window.location.href = url;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't start OAuth flow");
    }
  }

  async function createConnection() {
    if (!pid || !adding) return;
    setError(null);
    setConnecting(true);
    try {
      await apiFetch(`/v1/projects/${pid}/connections`, {
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

  async function testConnection(conn: ConnectionRow) {
    if (!pid) return;
    setBusyId(conn.id);
    setError(null);
    try {
      await apiFetch(`/v1/projects/${pid}/connections/${conn.id}/test`, { method: "POST" });
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
  function openTestDialog(conn: ConnectionRow) {
    if (conn.kind === "ai") {
      testConnection(conn);
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
    if (!pid || !testing) return;
    setTestBusy(true);
    setTestError(null);
    setTestSuccess(null);
    try {
      await apiFetch(`/v1/projects/${pid}/connections/${testing.id}/test-send-email`, {
        method: "POST",
        body: JSON.stringify({
          to: emailTestForm.to,
          cc: emailTestForm.cc || undefined,
          subject: emailTestForm.subject,
          body: emailTestForm.body,
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
    if (!pid || !testing) return;
    setTestBusy(true);
    setTestError(null);
    setTestSuccess(null);
    try {
      await apiFetch(`/v1/projects/${pid}/connections/${testing.id}/test-send-whatsapp`, {
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

  async function disconnect(conn: ConnectionRow) {
    if (!pid) return;
    if (!confirm(`Disconnect ${providerInfo(conn.provider)?.label ?? conn.provider}?`)) return;
    setBusyId(conn.id);
    setError(null);
    try {
      await apiFetch(`/v1/projects/${pid}/connections/${conn.id}`, { method: "DELETE" });
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
    if (p.auth === "oauth") startOAuth(p);
    else {
      setAdding(p);
      setCredentials({});
    }
  }

  const emailConns = connections.filter((c) => c.kind === "email");
  const waConns = connections.filter((c) => c.kind === "whatsapp");
  const aiConns = connections.filter((c) => c.kind === "ai");

  function section(kind: "email" | "whatsapp" | "ai", conns: ConnectionRow[]) {
    const { title, icon: Icon } = KIND_META[kind];
    return (
      <Card key={kind} className="overflow-hidden">
        <CardHeader className="flex-row items-center gap-2 space-y-0 border-b border-border bg-muted/30 py-3.5">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-display text-base font-semibold text-foreground">{title}</h2>
          {conns.length > 0 && (
            <Badge variant="secondary" className="ml-auto font-normal text-muted-foreground">
              {conns.length} connected
            </Badge>
          )}
        </CardHeader>
        <CardContent className="grid gap-0 p-0 lg:grid-cols-[1fr_300px]">
          <div className="flex flex-col justify-center p-5">
            {conns.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Provider</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {conns.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-semibold text-foreground">{providerInfo(c.provider)?.label ?? c.provider}</TableCell>
                      <TableCell className="text-muted-foreground">{c.account_label || "—"}</TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[c.status]} className="gap-1" title={c.needs_reconnect_reason ?? undefined}>
                          {c.status === "connected" ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                          {STATUS_LABEL[c.status]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1.5">
                          <Button variant="outline" size="sm" disabled={busyId === c.id} onClick={() => openTestDialog(c)}>
                            {busyId === c.id ? "…" : "Test"}
                          </Button>
                          <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" disabled={busyId === c.id} onClick={() => disconnect(c)}>
                            Disconnect
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground">No {title.toLowerCase()} providers connected yet.</p>
            )}
          </div>

          <div className="flex flex-col justify-center gap-2 border-t border-border bg-muted/20 p-4 lg:border-l lg:border-t-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Add a provider</p>
            <Select
              value={pendingProvider[kind] ?? ""}
              onChange={(e) => setPendingProvider({ ...pendingProvider, [kind]: e.target.value })}
            >
              <option value="">Choose a provider…</option>
              {PROVIDERS.filter((p) => p.kind === kind).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
            <Button size="sm" disabled={!pendingProvider[kind]} onClick={() => connectPending(kind)}>
              {PROVIDERS.find((p) => p.id === pendingProvider[kind])?.auth === "oauth" ? (
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
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-foreground">Email &amp; WhatsApp</h1>
        <p className="text-sm text-muted-foreground">Connect sender accounts. Credentials are encrypted at rest and never sent back to the browser.</p>
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
          {section("whatsapp", waConns)}
          {section("ai", aiConns)}
        </div>
      )}

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
    </div>
  );
}
