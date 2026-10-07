"use client";
import { useCallback, useEffect, useState } from "react";
import { apiFetch, ApiError } from "@/lib/apiClient";
import { createClient } from "@/lib/supabase/client";
import type { KbAssetRow, KbFolderRow } from "@/lib/types";

const BUCKET = "kb-assets";

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
    setUploading(true);
    setError(null);
    try {
      const supabase = createClient();
      for (const file of Array.from(files)) {
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
      }
      await refresh();
    } catch (e) {
      setError(e instanceof ApiError && e.status === 403 ? "You have view-only access and can't upload files." : e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
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

  return { folders, assets, loading, uploading, error, setError, refresh, uploadFiles, createFolder, deleteFolder, deleteAsset };
}
