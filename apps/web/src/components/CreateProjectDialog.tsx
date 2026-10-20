"use client";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/apiClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface ProjectRowLite {
  id: string;
}

/**
 * Two ways to get a new project: add it under the org you're already in
 * (the common case — a second brand/branch sharing the same team), or start
 * a fully separate organization (its own team, its own billing/members
 * later). The "same org" tab only makes sense when one exists — a brand-new
 * signup with zero orgs skips straight to "new organization".
 */
export function CreateProjectDialog({
  open,
  onOpenChange,
  currentOrgId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentOrgId: string | null;
  onCreated: (project: ProjectRowLite) => void;
}) {
  const [mode, setMode] = useState<"same_org" | "new_org">(currentOrgId ? "same_org" : "new_org");
  const [orgName, setOrgName] = useState("");
  const [projectName, setProjectName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setOrgName("");
    setProjectName("");
    setError(null);
    setMode(currentOrgId ? "same_org" : "new_org");
  }

  async function create() {
    if (!projectName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      let orgId = currentOrgId;
      if (mode === "new_org") {
        if (!orgName.trim()) {
          setError("Organization name is required.");
          setSaving(false);
          return;
        }
        const org = await apiFetch<{ id: string }>("/v1/orgs", { method: "POST", body: JSON.stringify({ name: orgName }) });
        orgId = org.id;
      }
      const project = await apiFetch<ProjectRowLite>(`/v1/orgs/${orgId}/projects`, { method: "POST", body: JSON.stringify({ name: projectName }) });
      onCreated(project);
      onOpenChange(false);
      reset();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't create the project.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>Set up a new project to run its own leads, templates, and connections.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {currentOrgId && (
            <div className="flex gap-1 rounded-lg bg-muted p-1">
              <button
                type="button"
                onClick={() => setMode("same_org")}
                className={cn(
                  "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  mode === "same_org" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                Add to this organization
              </button>
              <button
                type="button"
                onClick={() => setMode("new_org")}
                className={cn(
                  "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  mode === "new_org" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                Start a new organization
              </button>
            </div>
          )}
          {mode === "new_org" && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-org-name">Organization name</Label>
              <Input id="new-org-name" placeholder="e.g. your company or agency name" value={orgName} onChange={(e) => setOrgName(e.target.value)} autoFocus={!currentOrgId} />
              <p className="text-xs text-muted-foreground">A separate organization has its own team — projects and members here won&apos;t be visible from it.</p>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-project-name">Project name</Label>
            <Input id="new-project-name" placeholder="e.g. Acme Corp" value={projectName} onChange={(e) => setProjectName(e.target.value)} autoFocus={!!currentOrgId} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={create} disabled={saving || !projectName.trim() || (mode === "new_org" && !orgName.trim())}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving ? "Creating…" : "Create project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
