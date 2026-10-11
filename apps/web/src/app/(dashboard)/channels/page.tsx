"use client";
import { useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, Mail, MessageCircle, Plus, Sparkles } from "lucide-react";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { apiFetch, ApiError } from "@/lib/apiClient";
import { PROVIDERS, providerInfo, type ProviderInfo } from "@/lib/providerCatalog";
import type { ConnectionRow } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

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
  const { pid } = useWorkspace();

  const [connections, setConnections] = useState<ConnectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<string | null>(null);
  const [adding, setAdding] = useState<ProviderInfo | null>(null);
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

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

  const emailConns = connections.filter((c) => c.kind === "email");
  const waConns = connections.filter((c) => c.kind === "whatsapp");
  const aiConns = connections.filter((c) => c.kind === "ai");

  function section(kind: "email" | "whatsapp" | "ai", conns: ConnectionRow[]) {
    const { title, icon: Icon } = KIND_META[kind];
    return (
      <Card key={kind}>
        <CardHeader className="flex-row items-center gap-2 space-y-0 pb-3">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-display text-base font-semibold text-foreground">{title}</h2>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 pt-0">
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
                        <Button variant="outline" size="sm" disabled={busyId === c.id} onClick={() => testConnection(c)}>
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

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {PROVIDERS.filter((p) => p.kind === kind).map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => (p.auth === "oauth" ? startOAuth(p) : (setAdding(p), setCredentials({})))}
                className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2.5 text-left text-sm font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-accent"
              >
                {p.label}
                {p.auth === "oauth" ? <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" /> : <Plus className="h-3.5 w-3.5 text-muted-foreground" />}
              </button>
            ))}
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
        <div className="grid gap-5 lg:grid-cols-3">
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
    </div>
  );
}
