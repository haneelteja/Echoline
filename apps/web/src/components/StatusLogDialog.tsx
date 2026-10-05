"use client";
import { useState } from "react";
import { Plus } from "lucide-react";
import { apiFetch } from "@/lib/apiClient";
import type { StatusLogEntry } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface Props {
  pid: string;
  contactId: string;
  contactName: string;
  entries: StatusLogEntry[];
  onClose: () => void;
  onAdded: () => Promise<void>;
}

export function StatusLogDialog({ pid, contactId, contactName, entries, onClose, onAdded }: Props) {
  const [status, setStatus] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addEntry() {
    if (!status.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/v1/projects/${pid}/contacts/${contactId}/status-log`, {
        method: "POST",
        body: JSON.stringify({ status: status.trim(), followUpDate: followUpDate || null }),
      });
      setStatus("");
      setFollowUpDate("");
      await onAdded();
    } catch {
      setError("Couldn't add status update.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Status log — {contactName}</DialogTitle>
          <DialogDescription>Track what&apos;s happened with this lead and when to follow up next.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-[1fr_160px_auto] items-end gap-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="status-text">Status update</Label>
            <Input
              id="status-text"
              placeholder="e.g. Called, interested in bulk order"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="follow-up">Follow-up date</Label>
            <Input id="follow-up" type="date" value={followUpDate} onChange={(e) => setFollowUpDate(e.target.value)} />
          </div>
          <Button onClick={addEntry} disabled={!status.trim() || saving}>
            <Plus className="h-4 w-4" />
            Add
          </Button>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex max-h-80 flex-col gap-3 overflow-y-auto border-t border-border pt-3">
          {entries.length ? (
            entries.map((e) => (
              <div key={e.id} className="flex flex-col gap-0.5 rounded-md bg-muted/40 px-3 py-2">
                <p className="text-sm text-foreground">{e.status}</p>
                <p className="text-xs text-muted-foreground">
                  {new Date(e.created_at).toLocaleString()}
                  {e.follow_up_date && <> · Follow up {new Date(e.follow_up_date).toLocaleDateString()}</>}
                </p>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No status updates yet.</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
