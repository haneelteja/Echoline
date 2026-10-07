"use client";
import { useMemo, useRef, useState } from "react";
import { Check, ChevronRight, File, FolderPlus, Home, Loader2, Upload } from "lucide-react";
import { useKbAssets } from "@/lib/useKbAssets";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { KbAssetRow } from "@/lib/types";

interface AssetPickerProps {
  pid: string | null;
  open: boolean;
  onClose: () => void;
  /** "single" for a WhatsApp template header (one image or document);
   * "multi" for an email gallery (several images). */
  mode: "single" | "multi";
  kindFilter: "image" | "document" | "all";
  initialSelected: string[];
  onConfirm: (ids: string[]) => void;
}

/** Folder-browsing file picker shared by the WhatsApp header-media field and
 * the email gallery field in the template editor — same data/upload layer
 * as the Knowledge base page (useKbAssets), just a selection UI instead of
 * a management one. */
export function AssetPicker({ pid, open, onClose, mode, kindFilter, initialSelected, onConfirm }: AssetPickerProps) {
  const { folders, assets, loading, uploading, error, uploadFiles, createFolder } = useKbAssets(pid);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>(initialSelected);
  const [addingFolder, setAddingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const visibleAssets = useMemo(
    () => (kindFilter === "all" ? assets : assets.filter((a) => a.kind === kindFilter)),
    [assets, kindFilter]
  );

  const breadcrumb = useMemo(() => {
    const trail: { id: string; name: string }[] = [];
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
  const childAssets = visibleAssets.filter((a) => a.folder_id === currentFolderId);

  function toggle(id: string) {
    if (mode === "single") {
      setSelected((cur) => (cur[0] === id ? [] : [id]));
    } else {
      setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
    }
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

  function confirm() {
    onConfirm(selected);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{kindFilter === "image" ? "Choose image" : kindFilter === "document" ? "Choose document" : "Choose from knowledge base"}</DialogTitle>
        </DialogHeader>

        <div className="row" style={{ justifyContent: "space-between" }}>
          <div className="row small" style={{ gap: 4, color: "var(--muted)" }}>
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
          <div className="row small" style={{ gap: 8 }}>
            <Button variant="outline" size="sm" onClick={() => setAddingFolder((v) => !v)}>
              <FolderPlus className="h-3.5 w-3.5" />
              New folder
            </Button>
            <Button size="sm" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              {uploading ? "Uploading…" : "Upload"}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              accept={kindFilter === "image" ? "image/*" : undefined}
              onChange={(e) => handleFiles(e.target.files)}
            />
          </div>
        </div>

        {addingFolder && (
          <div className="row" style={{ flexWrap: "nowrap" }}>
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
          <p className="small" style={{ color: "var(--bad)" }}>
            {error}
          </p>
        )}

        <div style={{ maxHeight: 360, overflowY: "auto" }}>
          {loading ? (
            <p className="muted small">Loading…</p>
          ) : !childFolders.length && !childAssets.length ? (
            <p className="muted small">Nothing here yet.</p>
          ) : (
            <div className="grid g3">
              {childFolders.map((f) => (
                <div key={f.id} className="panel" style={{ cursor: "pointer" }} onClick={() => setCurrentFolderId(f.id)}>
                  <b className="small">📁 {f.name}</b>
                </div>
              ))}
              {childAssets.map((a) => (
                <AssetTile key={a.id} asset={a} selected={selected.includes(a.id)} onClick={() => toggle(a.id)} />
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={mode === "single" ? selected.length !== 1 : selected.length === 0}>
            {mode === "single" ? "Use selected" : `Use ${selected.length || ""} selected`.trim()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AssetTile({ asset, selected, onClick }: { asset: KbAssetRow; selected: boolean; onClick: () => void }) {
  return (
    <div
      className="panel"
      style={{ position: "relative", cursor: "pointer", outline: selected ? "2px solid var(--email)" : undefined }}
      onClick={onClick}
    >
      {asset.kind === "image" ? (
        <img src={asset.url} alt={asset.name} style={{ width: "100%", height: 90, objectFit: "cover", borderRadius: 8, marginBottom: 6 }} />
      ) : (
        <div className="row" style={{ height: 90, alignItems: "center", justifyContent: "center", marginBottom: 6 }}>
          <File className="h-8 w-8" style={{ color: "var(--muted)" }} />
        </div>
      )}
      <b className={cn("small", "block truncate")} title={asset.name}>
        {asset.name}
      </b>
      {selected && (
        <span
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            background: "var(--email)",
            color: "#fff",
            borderRadius: "50%",
            width: 20,
            height: 20,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Check className="h-3 w-3" />
        </span>
      )}
    </div>
  );
}
