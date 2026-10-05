"use client";
import { useState } from "react";
import { Mail, MessageCircle, Send } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/apiClient";
import type { TemplateRow } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface Props {
  pid: string;
  contactId: string;
  contactName: string;
  channel: "email" | "whatsapp";
  templates: TemplateRow[];
  onClose: () => void;
}

export function SendNowDialog({ pid, contactId, contactName, channel, templates, onClose }: Props) {
  const options = templates.filter((t) => t.channel === channel);
  const [templateId, setTemplateId] = useState(options[0]?.id ?? "");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function send() {
    if (!templateId) return;
    setSending(true);
    setError(null);
    try {
      await apiFetch(`/v1/projects/${pid}/contacts/${contactId}/send-now`, {
        method: "POST",
        body: JSON.stringify({ channel, templateId }),
      });
      setSent(true);
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message || "Send failed.");
      } else {
        setError("Send failed.");
      }
    } finally {
      setSending(false);
    }
  }

  const Icon = channel === "email" ? Mail : MessageCircle;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className="h-4 w-4" />
            Send {channel === "email" ? "email" : "WhatsApp"} now — {contactName}
          </DialogTitle>
          <DialogDescription>Sends immediately, outside the normal sequence timing.</DialogDescription>
        </DialogHeader>

        {!sent ? (
          <>
            {options.length ? (
              <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                {options.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name || `Step ${t.step}`}
                  </option>
                ))}
              </Select>
            ) : (
              <p className="text-sm text-muted-foreground">
                No {channel === "email" ? "email" : "WhatsApp"} templates exist for this project yet.
              </p>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button variant="outline" onClick={onClose} disabled={sending}>
                Cancel
              </Button>
              <Button onClick={send} disabled={!templateId || sending}>
                <Send className="h-4 w-4" />
                {sending ? "Sending…" : "Send now"}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <p className="text-sm text-foreground">Sent.</p>
            <DialogFooter>
              <Button onClick={onClose}>Done</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
