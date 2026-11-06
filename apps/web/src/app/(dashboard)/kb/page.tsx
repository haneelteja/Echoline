"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronRight,
  File,
  Folder,
  FolderPlus,
  Globe,
  Home,
  Info,
  Loader2,
  Megaphone,
  MessageCircle,
  Receipt,
  Tag,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { useKbAssets } from "@/lib/useKbAssets";
import { UploadProgress } from "@/components/UploadProgress";
import { apiFetch, ApiError } from "@/lib/apiClient";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { KbAssetRow, KbFolderRow } from "@/lib/types";

const BRAND_FIELDS = [
  { key: "about", label: "About", icon: Info, rows: 4 },
  { key: "offer", label: "Offer / USP", icon: Tag, rows: 4 },
  { key: "pricing", label: "Pricing notes", icon: Receipt, rows: 4 },
  { key: "tone", label: "Tone", icon: MessageCircle, rows: 2 },
  { key: "cta", label: "Call to action", icon: Megaphone, rows: 2 },
] as const;
type BrandFieldKey = (typeof BRAND_FIELDS)[number]["key"];

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function KbPage() {
  const { pid, project, brand, refreshProjectData, refreshProjects } = useWorkspace();
  const { folders, assets, loading, uploading, uploadQueue, error, uploadFiles, createFolder, deleteFolder, deleteAsset, deleteAssets, moveAssets } = useKbAssets(pid);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);

  const [brandDraft, setBrandDraft] = useState<Record<BrandFieldKey, string>>({ about: "", offer: "", pricing: "", tone: "", cta: "" });
  // Website lives on `projects` (project.website), not the brand_kb row —
  // shown here anyway since it's a brand fact AI templates read, same as the
  // rest of this card, but saved via /v1/projects/:id instead of /brand.
  const [website, setWebsite] = useState("");
  const [savingBrand, setSavingBrand] = useState(false);
  const [brandSaved, setBrandSaved] = useState(false);
  const [brandError, setBrandError] = useState<string | null>(null);

  // brand/project load async (null on first render) — re-sync whenever they
  // change, same pattern as project/page.tsx's name/brand/sender fields.
  useEffect(() => {
    if (!brand) return;
    setBrandDraft({
      about: brand.about ?? "",
      offer: brand.offer ?? "",
      pricing: brand.pricing ?? "",
      tone: brand.tone ?? "",
      cta: brand.cta ?? "",
    });
  }, [brand]);

  useEffect(() => {
    if (!project) return;
    setWebsite(project.website ?? "");
  }, [project]);

  async function saveBrand() {
    if (!pid) return;
    setSavingBrand(true);
    setBrandError(null);
    setBrandSaved(false);
    // allSettled, not all — these hit two different tables (brand_kb,
    // projects) via two separate requests, so one failing (a transient
    // network blip, a cold-started API) must not hide that the other one
    // actually landed. Always refresh afterward so whichever succeeded is
    // reflected, and say which half failed rather than a generic "Couldn't
    // save." that could describe either or both.
    const [brandResult, websiteResult] = await Promise.allSettled([
      apiFetch(`/v1/projects/${pid}/brand`, {
        method: "PUT",
        body: JSON.stringify({ ...brandDraft, skus: brand?.skus ?? [] }),
      }),
      apiFetch(`/v1/projects/${pid}`, { method: "PATCH", body: JSON.stringify({ website }) }),
    ]);
    await Promise.all([refreshProjectData(), refreshProjects()]);
    const forbidden = [brandResult, websiteResult].some((r) => r.status === "rejected" && r.reason instanceof ApiError && r.reason.status === 403);
    if (forbidden) {
      setBrandError("You have view-only access and can't edit brand facts.");
    } else if (brandResult.status === "rejected" && websiteResult.status === "rejected") {
      setBrandError("Couldn't save.");
    } else if (brandResult.status === "rejected") {
      setBrandError("Website saved, but the other brand facts failed to save — try again.");
    } else if (websiteResult.status === "rejected") {
      setBrandError("Brand facts saved, but the website failed to save — try again.");
    } else {
      setBrandSaved(true);
    }
    setSavingBrand(false);
  }
  const [addingFolder, setAddingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moveTarget, setMoveTarget] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const breadcrumb = useMemo(() => {
    const trail: { id: string | null; name: string }[] = [];
    let cursor = currentFolderId;
    while (cursor) {
      const f = folders.find((x) => x.id === cursor);
      if (!f) break;
      trail.unshift({ id: f.id, name: f.name });
      cursor = f.parent_id;
    }
    return trail;
  }, [currentFolderId, folders]);

  const childFolders = folders.filter((f) => f.parent_id === currentFolderId);
  const childAssets = assets.filter((a) => a.folder_id === currentFolderId);

  function goToFolder(id: string | null) {
    setCurrentFolderId(id);
    setSelected(new Set());
  }

  function toggleSelected(id: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    await uploadFiles(files, currentFolderId);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function submitNewFolder() {
    await createFolder(newFolderName, currentFolderId);
    setNewFolderName("");
    setAddingFolder(false);
  }

  async function bulkDelete() {
    if (!confirm(`Delete ${selected.size} file${selected.size === 1 ? "" : "s"}?`)) return;
    await deleteAssets([...selected]);
    setSelected(new Set());
  }

  async function bulkMove() {
    if (!moveTarget) return;
    await moveAssets([...selected], moveTarget === "root" ? null : moveTarget);
    setSelected(new Set());
    setMoveTarget("");
  }

  return (
    <>
      <div className="top">
        <div>
          <h1>Knowledge base</h1>
          <p>What the AI and your templates know about this project.</p>
        </div>
      </div>
      <Card className="mb-5">
        <CardHeader>
          <CardTitle>Brand facts</CardTitle>
          <CardDescription>Edit the facts your AI drafts and templates pull from.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5 sm:max-w-sm">
            <Label htmlFor="brand-website" className="inline-flex items-center gap-1.5 text-muted-foreground">
              <Globe className="h-3.5 w-3.5" />
              Website
            </Label>
            <Input id="brand-website" placeholder="https://yourcompany.com" value={website} onChange={(e) => setWebsite(e.target.value)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {BRAND_FIELDS.map(({ key, label, icon: Icon, rows }) => (
              <div key={key} className="flex flex-col gap-1.5">
                <Label htmlFor={`brand-${key}`} className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </Label>
                <Textarea
                  id={`brand-${key}`}
                  rows={rows}
                  value={brandDraft[key]}
                  onChange={(e) => setBrandDraft({ ...brandDraft, [key]: e.target.value })}
                  className="resize-none"
                />
              </div>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={saveBrand} disabled={savingBrand}>
              {savingBrand && <Loader2 className="h-4 w-4 animate-spin" />}
              {savingBrand ? "Saving…" : "Save brand facts"}
            </Button>
            {brandSaved && (
              <span className="inline-flex items-center gap-1 text-sm font-medium text-success">
                <Check className="h-4 w-4" />
                Saved
              </span>
            )}
            {brandError && <p className="text-sm text-destructive">{brandError}</p>}
          </div>
        </CardContent>
      </Card>
      <p className="hint mb-4">
        SKU management is on the backlog, planned alongside real pgvector retrieval for AI context (see
        docs/ROADMAP.md). AI template generation reads these brand facts as plain text.
      </p>

      <section className="panel">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2>Files</h2>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setAddingFolder((v) => !v)}>
              <FolderPlus className="h-3.5 w-3.5" />
              New folder
            </Button>
            <Button size="sm" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              {uploading ? "Uploading…" : "Upload"}
            </Button>
            <input ref={fileInputRef} type="file" multiple hidden onChange={(e) => handleFiles(e.target.files)} />
          </div>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-1 text-sm">
          <button
            className={cn("flex items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-accent", currentFolderId ? "text-muted-foreground" : "font-medium text-foreground")}
            onClick={() => goToFolder(null)}
          >
            <Home className="h-3.5 w-3.5" />
            Files
          </button>
          {breadcrumb.map((b, i) => (
            <span key={b.id} className="flex items-center gap-1">
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              <button
                className={cn("rounded-md px-1.5 py-1 hover:bg-accent", i === breadcrumb.length - 1 ? "font-medium text-foreground" : "text-muted-foreground")}
                onClick={() => goToFolder(b.id)}
              >
                {b.name}
              </button>
            </span>
          ))}
        </div>

        {addingFolder && (
          <div className="mb-4 flex flex-nowrap items-center gap-2">
            <Input
              autoFocus
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="Folder name"
              onKeyDown={(e) => e.key === "Enter" && submitNewFolder()}
              className="max-w-60"
            />
            <Button size="sm" onClick={submitNewFolder} disabled={!newFolderName.trim()}>
              Create
            </Button>
            <Button size="sm" variant="outline" onClick={() => setAddingFolder(false)}>
              Cancel
            </Button>
          </div>
        )}

        {selected.size > 0 && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-accent px-3.5 py-2.5">
            <span className="text-sm font-semibold">{selected.size} selected</span>
            <div className="flex items-center gap-2">
              <Select value={moveTarget} onChange={(e) => setMoveTarget(e.target.value)} className="h-8 text-sm">
                <option value="">Move to…</option>
                <option value="root">Files (root)</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {folderPath(f, folders)}
                  </option>
                ))}
              </Select>
              <Button size="sm" variant="outline" disabled={!moveTarget} onClick={bulkMove}>
                Move
              </Button>
              <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={bulkDelete}>
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                <X className="h-3.5 w-3.5" />
                Clear
              </Button>
            </div>
          </div>
        )}

        {uploadQueue.length > 0 && (
          <div className="mb-4">
            <UploadProgress items={uploadQueue} />
          </div>
        )}

        {error && <p className="mb-3 text-sm text-destructive">{error}</p>}

        {loading ? (
          <p className="muted small">Loading…</p>
        ) : !childFolders.length && !childAssets.length ? (
          <div className="empty">
            <FolderPlus className="mx-auto h-8 w-8 text-muted-foreground" />
            <p>Nothing here yet. Upload a photo or document, or create a folder.</p>
          </div>
        ) : (
          <div className="grid g3">
            {childFolders.map((f) => {
              const count = folders.filter((x) => x.parent_id === f.id).length + assets.filter((a) => a.folder_id === f.id).length;
              return (
                <div
                  key={f.id}
                  className="group panel relative cursor-pointer transition-shadow hover:shadow-md"
                  onClick={() => goToFolder(f.id)}
                >
                  <div className="flex items-center gap-2">
                    <Folder className="h-5 w-5 shrink-0 text-primary" />
                    <b className="small truncate">{f.name}</b>
                  </div>
                  <div className="small muted mt-1">{count ? `${count} item${count === 1 ? "" : "s"}` : "Empty"}</div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-2 top-2 h-7 w-7 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Delete folder "${f.name}"? Subfolders are deleted too; files inside become unfiled.`)) deleteFolder(f.id);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              );
            })}
            {childAssets.map((a) => (
              <AssetCard
                key={a.id}
                asset={a}
                selected={selected.has(a.id)}
                onToggle={() => toggleSelected(a.id)}
                onDelete={() => confirm(`Delete "${a.name}"?`) && deleteAsset(a.id)}
              />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function folderPath(f: KbFolderRow, all: KbFolderRow[]): string {
  const parts = [f.name];
  let cursor = f.parent_id;
  while (cursor) {
    const parent = all.find((x) => x.id === cursor);
    if (!parent) break;
    parts.unshift(parent.name);
    cursor = parent.parent_id;
  }
  return parts.join(" / ");
}

function AssetCard({
  asset,
  selected,
  onToggle,
  onDelete,
}: {
  asset: KbAssetRow;
  selected: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={cn("group panel relative cursor-pointer transition-shadow hover:shadow-md", selected && "ring-2 ring-primary")}
      onClick={onToggle}
    >
      <span
        className={cn(
          "absolute left-2.5 top-2.5 z-10 flex h-5 w-5 items-center justify-center rounded border",
          selected ? "border-primary bg-primary" : "border-border bg-background"
        )}
      >
        {selected && <Check className="h-3 w-3 text-primary-foreground" />}
      </span>
      {asset.kind === "image" ? (
        <img src={asset.url} alt={asset.name} className="mb-2 h-[110px] w-full rounded-md object-cover" />
      ) : (
        <div className="mb-2 flex h-[110px] items-center justify-center rounded-md bg-muted">
          <File className="h-10 w-10 text-muted-foreground" />
        </div>
      )}
      <b className="small block truncate" title={asset.name}>
        {asset.name}
      </b>
      <div className="small muted">{formatSize(asset.size_bytes)}</div>
      <Button
        variant="ghost"
        size="icon"
        className="absolute right-2 top-2 h-7 w-7 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
