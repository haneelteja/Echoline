"use client";
import { useCallback, useEffect, useState } from "react";
import { apiFetch, ApiError } from "@/lib/apiClient";
import { createClient } from "@/lib/supabase/client";
import type { KbAssetRow, KbFolderRow } from "@/lib/types";

const BUCKET = "kb-assets";

export interface UploadItem {
  name: string;
  status: "pending" | "uploading" | "done" | "error";
  errorMessage?: string;
}

/**
 * Shared data layer for the Knowledge base file browser and the template
 * editor's AssetPicker — both need the same folder tree + asset list, and
 * the same upload/create/delete actions. Files upload straight from the
 * browser to Supabase Storage using the user's own session (storage.objects
 * RLS in 0014_kb_assets.sql enforces can_write_project the same way table
 * RLS does), then a small API call records the row — no bytes are proxied
 * through the Fastify API.
 */
export function useKbAssets(pid: string | null) {
  const [folders, setFolders] = useState<KbFolderRow[]>([]);
  const [assets, setAssets] = useState<KbAssetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadQueue, setUploadQueue] = useState<UploadItem[]>([]);

  const refresh = useCallback(async () => {
    if (!pid) return;
    setLoading(true);
    setError(null);
    try {
      const [f, a] = await Promise.all([
        apiFetch<KbFolderRow[]>(`/v1/projects/${pid}/kb/folders`),
        apiFetch<KbAssetRow[]>(`/v1/projects/${pid}/kb/assets`),
      ]);
      setFolders(f);
      setAssets(a);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load files");
    } finally {
      setLoading(false);
    }
  }, [pid]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function uploadFiles(files: FileList | File[], folderId: string | null): Promise<void> {
    if (!pid) return;
    const fileArr = Array.from(files);
    if (!fileArr.length) return;
    setUploading(true);
    setError(null);
    setUploadQueue(fileArr.map((f) => ({ name: f.name, status: "pending" })));

    const supabase = createClient();
    const failed: string[] = [];
    for (let i = 0; i < fileArr.length; i++) {
      const file = fileArr[i];
      setUploadQueue((q) => q.map((item, idx) => (idx === i ? { ...item, status: "uploading" } : item)));
      try {
        const ext = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".")) : "";
        const path = `${pid}/${crypto.randomUUID()}${ext}`;
        const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || "application/octet-stream" });
        if (upErr) throw upErr;
        const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
        const kind: "image" | "document" = file.type.startsWith("image/") ? "image" : "document";
        await apiFetch(`/v1/projects/${pid}/kb/assets`, {
          method: "POST",
          body: JSON.stringify({
            folderId,
            kind,
            name: file.name,
            mimeType: file.type || "application/octet-stream",
            sizeBytes: file.size,
            storagePath: path,
            url: pub.publicUrl,
          }),
        });
        setUploadQueue((q) => q.map((item, idx) => (idx === i ? { ...item, status: "done" } : item)));
      } catch (e) {
        // Keep going on a per-file failure rather than abandoning the rest
        // of the batch — one bad file (wrong type, name collision, etc.)
        // shouldn't block everything else the user selected.
        const msg = e instanceof ApiError && e.status === 403 ? "View-only access" : e instanceof Error ? e.message : "Upload failed";
        setUploadQueue((q) => q.map((item, idx) => (idx === i ? { ...item, status: "error", errorMessage: msg } : item)));
        failed.push(file.name);
      }
    }
    await refresh();
    if (failed.length) setError(`${failed.length} file${failed.length === 1 ? "" : "s"} failed to upload: ${failed.join(", ")}`);
    setUploading(false);
    // Leave the final state visible briefly so completed/errored rows are
    // readable, then clear so the panel doesn't linger after the user moves on.
    setTimeout(() => setUploadQueue([]), 2500);
  }

  async function createFolder(name: string, parentId: string | null): Promise<void> {
    if (!pid || !name.trim()) return;
    try {
      await apiFetch(`/v1/projects/${pid}/kb/folders`, { method: "POST", body: JSON.stringify({ name: name.trim(), parent_id: parentId }) });
      await refresh();
    } catch (e) {
      setError(e instanceof ApiError && e.status === 403 ? "You have view-only access and can't create folders." : "Couldn't create folder.");
    }
  }

  async function deleteFolder(id: string): Promise<void> {
    if (!pid) return;
    try {
      await apiFetch(`/v1/projects/${pid}/kb/folders/${id}`, { method: "DELETE" });
      await refresh();
    } catch (e) {
      setError(e instanceof ApiError && e.status === 403 ? "You have view-only access and can't delete folders." : "Couldn't delete folder.");
    }
  }

  async function deleteAsset(id: string): Promise<void> {
    if (!pid) return;
    try {
      await apiFetch(`/v1/projects/${pid}/kb/assets/${id}`, { method: "DELETE" });
      await refresh();
    } catch (e) {
      setError(e instanceof ApiError && e.status === 403 ? "You have view-only access and can't delete files." : "Couldn't delete file.");
    }
  }

  // Bulk variants for the Knowledge base page's multi-select toolbar — loop
  // over the same single-item endpoints (fine at per-project file-library
  // scale) and refresh once at the end instead of after every item.
  async function deleteAssets(ids: string[]): Promise<void> {
    if (!pid || !ids.length) return;
    try {
      for (const id of ids) {
        await apiFetch(`/v1/projects/${pid}/kb/assets/${id}`, { method: "DELETE" });
      }
      await refresh();
    } catch (e) {
      setError(e instanceof ApiError && e.status === 403 ? "You have view-only access and can't delete files." : "Couldn't delete one or more files.");
    }
  }

  async function moveAssets(ids: string[], folderId: string | null): Promise<void> {
    if (!pid || !ids.length) return;
    try {
      for (const id of ids) {
        await apiFetch(`/v1/projects/${pid}/kb/assets/${id}`, { method: "PATCH", body: JSON.stringify({ folderId }) });
      }
      await refresh();
    } catch (e) {
      setError(e instanceof ApiError && e.status === 403 ? "You have view-only access and can't move files." : "Couldn't move one or more files.");
    }
  }

  return { folders, assets, loading, uploading, uploadQueue, error, setError, refresh, uploadFiles, createFolder, deleteFolder, deleteAsset, deleteAssets, moveAssets };
}
