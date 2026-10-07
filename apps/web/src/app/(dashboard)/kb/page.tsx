"use client";
import { useMemo, useRef, useState } from "react";
import { ChevronRight, File, FolderPlus, Home, Loader2, Trash2, Upload } from "lucide-react";
import { useWorkspace } from "@/components/WorkspaceProvider";
import { useKbAssets } from "@/lib/useKbAssets";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { KbAssetRow } from "@/lib/types";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function KbPage() {
  const { pid, brand } = useWorkspace();
  const { folders, assets, loading, uploading, error, uploadFiles, createFolder, deleteFolder, deleteAsset } = useKbAssets(pid);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [addingFolder, setAddingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
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

  return (
    <>
      <div className="top">
        <div>
          <h1>Knowledge base</h1>
          <p>What the AI and your templates know about this project.</p>
        </div>
      </div>
      <section className="panel" style={{ maxWidth: 680, marginBottom: 20 }}>
        <h2 style={{ marginBottom: 12 }}>Brand facts</h2>
        {[
          ["About", brand?.about],
          ["Offer / USP", brand?.offer],
          ["Pricing notes", brand?.pricing],
          ["Tone", brand?.tone],
          ["Call to action", brand?.cta],
        ].map(([label, value]) => (
          <div key={label} style={{ marginBottom: 14 }}>
            <div className="small" style={{ fontWeight: 600, color: "var(--ink2)" }}>
              {label}
            </div>
            <p className="small">{value || "—"}</p>
          </div>
        ))}
      </section>
      <p className="hint" style={{ marginBottom: 16 }}>
        Editing and SKU management are on the backlog, planned alongside real pgvector retrieval for AI
        context (see docs/ROADMAP.md). AI template generation already reads these brand facts as plain
        text.
      </p>

      <section className="panel">
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 14 }}>
          <h2>Files</h2>
          <div className="row small" style={{ gap: 8 }}>
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

        <div className="row small" style={{ gap: 4, marginBottom: 14, color: "var(--muted)" }}>
          <button className="row small" style={{ gap: 4, color: currentFolderId ? "var(--muted)" : "var(--ink)" }} onClick={() => setCurrentFolderId(null)}>
            <Home className="h-3.5 w-3.5" />
            Files
          </button>
          {breadcrumb.map((b, i) => (
            <span key={b.id} className="row small" style={{ gap: 4 }}>
              <ChevronRight className="h-3 w-3" />
              <button style={{ color: i === breadcrumb.length - 1 ? "var(--ink)" : "var(--muted)" }} onClick={() => setCurrentFolderId(b.id)}>
                {b.name}
              </button>
            </span>
          ))}
        </div>

        {addingFolder && (
          <div className="row" style={{ marginBottom: 14, flexWrap: "nowrap" }}>
            <Input
              autoFocus
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="Folder name"
              onKeyDown={(e) => e.key === "Enter" && submitNewFolder()}
              style={{ maxWidth: 240 }}
            />
            <Button size="sm" onClick={submitNewFolder} disabled={!newFolderName.trim()}>
              Create
            </Button>
            <Button size="sm" variant="outline" onClick={() => setAddingFolder(false)}>
              Cancel
            </Button>
          </div>
        )}

        {error && (
          <p className="small" style={{ color: "var(--bad)", marginBottom: 12 }}>
            {error}
          </p>
        )}

        {loading ? (
          <p className="muted small">Loading…</p>
        ) : !childFolders.length && !childAssets.length ? (
          <p className="muted small">Nothing here yet. Upload a photo or document, or create a folder.</p>
        ) : (
          <div className="grid g3">
            {childFolders.map((f) => {
              const count = folders.filter((x) => x.parent_id === f.id).length + assets.filter((a) => a.folder_id === f.id).length;
              return (
                <div key={f.id} className="panel" style={{ cursor: "pointer", position: "relative" }} onClick={() => setCurrentFolderId(f.id)}>
                  <b className="small">📁 {f.name}</b>
                  <div className="small muted">{count ? `${count} item${count === 1 ? "" : "s"}` : "Empty"}</div>
                  <button
                    className="btn small danger"
                    style={{ position: "absolute", top: 10, right: 10 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Delete folder "${f.name}"? Subfolders are deleted too; files inside become unfiled.`)) deleteFolder(f.id);
                    }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
            {childAssets.map((a) => (
              <AssetCard key={a.id} asset={a} onDelete={() => confirm(`Delete "${a.name}"?`) && deleteAsset(a.id)} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function AssetCard({ asset, onDelete }: { asset: KbAssetRow; onDelete: () => void }) {
  return (
    <div className="panel" style={{ position: "relative" }}>
      {asset.kind === "image" ? (
        <img src={asset.url} alt={asset.name} style={{ width: "100%", height: 110, objectFit: "cover", borderRadius: 8, marginBottom: 8 }} />
      ) : (
        <div className="row" style={{ height: 110, alignItems: "center", justifyContent: "center", marginBottom: 8 }}>
          <File className="h-10 w-10" style={{ color: "var(--muted)" }} />
        </div>
      )}
      <b className="small" style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={asset.name}>
        {asset.name}
      </b>
      <div className="small muted">{formatSize(asset.size_bytes)}</div>
      <button className="btn small danger" style={{ position: "absolute", top: 10, right: 10 }} onClick={onDelete}>
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}
