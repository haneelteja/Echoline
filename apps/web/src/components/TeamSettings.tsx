"use client";
import { useEffect, useState } from "react";
import { Loader2, Mail, Plus, Trash2, UserCircle2 } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/apiClient";
import type { InviteRow, MemberRow, MembershipRole } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const INVITABLE_ROLES: { value: MembershipRole; label: string; blurb: string }[] = [
  { value: "admin", label: "Admin", blurb: "Full access — manage connections, invite others, edit everything." },
  { value: "operator", label: "Operator", blurb: "Can send campaigns, edit sequences/templates, manage leads." },
  { value: "viewer", label: "Viewer", blurb: "Read-only access to everything." },
  { value: "client_viewer", label: "Client viewer", blurb: "Read-only, scoped to specific projects only." },
];

const ROLE_VARIANT: Record<MembershipRole, "default" | "secondary" | "success"> = {
  owner: "success",
  admin: "default",
  operator: "default",
  viewer: "secondary",
  client_viewer: "secondary",
};

function roleLabel(role: MembershipRole): string {
  if (role === "owner") return "Owner";
  return INVITABLE_ROLES.find((r) => r.value === role)?.label ?? role;
}

export function TeamSettings({ orgId }: { orgId: string }) {
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<MembershipRole>("admin");
  const [sendingInvite, setSendingInvite] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSent, setInviteSent] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [m, i] = await Promise.all([
        apiFetch<MemberRow[]>(`/v1/orgs/${orgId}/members`),
        apiFetch<InviteRow[]>(`/v1/orgs/${orgId}/invites`),
      ]);
      setMembers(m);
      setInvites(i);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load the team.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  async function sendInvite() {
    if (!inviteEmail.trim()) return;
    setSendingInvite(true);
    setInviteError(null);
    try {
      await apiFetch(`/v1/orgs/${orgId}/invites`, { method: "POST", body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }) });
      setInviteSent(inviteEmail.trim());
      setInviteEmail("");
      await refresh();
    } catch (e) {
      setInviteError(
        e instanceof ApiError && e.status === 403
          ? "Only an owner or admin can invite teammates."
          : e instanceof ApiError
            ? e.message
            : "Couldn't send the invite."
      );
    } finally {
      setSendingInvite(false);
    }
  }

  async function changeRole(membershipId: string, role: MembershipRole) {
    setBusyId(membershipId);
    setError(null);
    try {
      await apiFetch(`/v1/orgs/${orgId}/members/${membershipId}`, { method: "PATCH", body: JSON.stringify({ role }) });
      await refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't change that member's role.");
    } finally {
      setBusyId(null);
    }
  }

  async function removeMember(membershipId: string) {
    if (!confirm("Remove this person from the organization?")) return;
    setBusyId(membershipId);
    setError(null);
    try {
      await apiFetch(`/v1/orgs/${orgId}/members/${membershipId}`, { method: "DELETE" });
      await refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't remove that member.");
    } finally {
      setBusyId(null);
    }
  }

  async function revokeInvite(inviteId: string) {
    setBusyId(inviteId);
    try {
      await apiFetch(`/v1/orgs/${orgId}/invites/${inviteId}/revoke`, { method: "POST" });
      await refresh();
    } catch {
      setError("Couldn't revoke that invite.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card className="mt-5">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle>Team</CardTitle>
          <CardDescription>The project creator stays owner. Invite others as admin or a more limited role.</CardDescription>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setInviting(true);
            setInviteError(null);
            setInviteSent(null);
          }}
        >
          <Plus className="h-3.5 w-3.5" />
          Invite
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error && <p className="text-sm text-destructive">{error}</p>}
        {loading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading team…
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium text-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        <UserCircle2 className="h-4 w-4 text-muted-foreground" />
                        {m.email ?? m.user_id}
                      </span>
                    </TableCell>
                    <TableCell>
                      {m.role === "owner" ? (
                        <Badge variant={ROLE_VARIANT.owner}>Owner</Badge>
                      ) : (
                        <Select
                          value={m.role}
                          disabled={busyId === m.id}
                          onChange={(e) => changeRole(m.id, e.target.value as MembershipRole)}
                          className="h-8 w-[160px] text-xs"
                        >
                          {INVITABLE_ROLES.map((r) => (
                            <option key={r.value} value={r.value}>
                              {r.label}
                            </option>
                          ))}
                        </Select>
                      )}
                    </TableCell>
                    <TableCell>
                      {m.role !== "owner" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                          disabled={busyId === m.id}
                          onClick={() => removeMember(m.id)}
                          title="Remove from organization"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {invites.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pending invites</p>
                {invites.map((inv) => (
                  <div key={inv.id} className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-border px-3 py-2">
                    <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                      <Mail className="h-3.5 w-3.5" />
                      {inv.email}
                      <Badge variant="secondary" className="font-normal">
                        {roleLabel(inv.role)}
                      </Badge>
                    </span>
                    <Button variant="outline" size="sm" disabled={busyId === inv.id} onClick={() => revokeInvite(inv.id)}>
                      Revoke
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>

      <Dialog
        open={inviting}
        onOpenChange={(v) => {
          setInviting(v);
          if (!v) setInviteSent(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite a teammate</DialogTitle>
            <DialogDescription>They&apos;ll get an email with a link to accept. The invite expires in 7 days.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="invite-email">Email</Label>
              <Input id="invite-email" type="email" placeholder="teammate@company.com" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} autoFocus />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="invite-role">Role</Label>
              <Select id="invite-role" value={inviteRole} onChange={(e) => setInviteRole(e.target.value as MembershipRole)}>
                {INVITABLE_ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-muted-foreground">{INVITABLE_ROLES.find((r) => r.value === inviteRole)?.blurb}</p>
            </div>
            {inviteError && <p className="text-sm text-destructive">{inviteError}</p>}
            {inviteSent && (
              <p className="text-sm font-medium text-success">Invite sent to {inviteSent}.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviting(false)}>
              Done
            </Button>
            <Button onClick={sendInvite} disabled={sendingInvite || !inviteEmail.trim()}>
              {sendingInvite && <Loader2 className="h-4 w-4 animate-spin" />}
              {sendingInvite ? "Sending…" : "Send invite"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
