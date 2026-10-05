"use client";
import { useState } from "react";
import { FileSpreadsheet, Plus, Upload } from "lucide-react";
import { statusLabel, type ContactChannelStatus } from "@echoline/core";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { apiFetch, ApiError } from "@/lib/apiClient";
import { ImportLeadsDialog } from "@/components/ImportLeadsDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const TERMINAL_GOOD: ContactChannelStatus[] = ["completed", "replied"];
const TERMINAL_BAD: ContactChannelStatus[] = ["opted_out", "invalid", "bounced", "failed"];

function statusVariant(status: ContactChannelStatus): "success" | "destructive" | "secondary" | "default" {
  if (TERMINAL_GOOD.includes(status)) return "success";
  if (TERMINAL_BAD.includes(status)) return "destructive";
  if (status === "not_contacted") return "secondary";
  return "default";
}

export default function ContactsPage() {
  const { pid, contacts, refreshProjectData } = useWorkspace();
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">Leads &amp; status</h1>
          <p className="text-sm text-muted-foreground">{contacts.length} leads</p>
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

      {importing && pid && <ImportLeadsDialog pid={pid} onClose={() => setImporting(false)} onImported={refreshProjectData} />}

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

      {contacts.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Business</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Area</TableHead>
              <TableHead>Email status</TableHead>
              <TableHead>WhatsApp status</TableHead>
              <TableHead>Source</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {contacts.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-semibold text-foreground">{c.name}</TableCell>
                <TableCell className="text-muted-foreground">{c.category || "—"}</TableCell>
                <TableCell className="text-muted-foreground">{c.area || "—"}</TableCell>
                <TableCell>
                  <Badge variant={statusVariant(c.em_status)}>{statusLabel(c.em_status)}</Badge>
                </TableCell>
                <TableCell>
                  <Badge variant={statusVariant(c.wa_status)}>{statusLabel(c.wa_status)}</Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{c.source || "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <Card>
          <CardHeader className="items-center gap-2 text-center">
            <FileSpreadsheet className="h-8 w-8 text-muted-foreground" />
            <h2 className="font-display text-lg font-semibold text-foreground">No leads in this project</h2>
            <p className="text-sm text-muted-foreground">
              Add a lead by hand, import an Excel file, or connect a{" "}
              <a href="/sources" className="text-primary underline underline-offset-4">
                webhook or website form
              </a>{" "}
              to import automatically.
            </p>
          </CardHeader>
        </Card>
      )}
    </div>
  );
}
