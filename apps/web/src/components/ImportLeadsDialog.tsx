"use client";
import { useState } from "react";
import { FileUp, Upload } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/apiClient";
import {
  applyColumnMapping,
  CONTACT_FIELDS,
  guessColumnMapping,
  parseExcelFile,
  type ContactFieldKey,
  type ParsedSheet,
} from "@/lib/excelImport";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface Props {
  pid: string;
  onClose: () => void;
  onImported: () => Promise<void>;
}

export function ImportLeadsDialog({ pid, onClose, onImported }: Props) {
  const [sheet, setSheet] = useState<ParsedSheet | null>(null);
  const [mapping, setMapping] = useState<Record<ContactFieldKey, string | null> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ added: number; skipped: number; failed: number } | null>(null);

  async function onFileSelected(file: File) {
    setError(null);
    try {
      const parsed = await parseExcelFile(file);
      if (!parsed.headers.length) {
        setError("Couldn't find a header row in this file.");
        return;
      }
      setSheet(parsed);
      setMapping(guessColumnMapping(parsed.headers));
    } catch (e) {
      console.error("Excel import: failed to parse file", e);
      setError("Couldn't read this file — make sure it's a valid .xlsx/.xls/.csv file.");
    }
  }

  async function confirmImport() {
    if (!sheet || !mapping) return;
    setError(null);
    setImporting(true);
    try {
      const rows = applyColumnMapping(sheet, mapping);
      if (!rows.length) {
        setError("No rows matched the selected Business name column.");
        setImporting(false);
        return;
      }
      const res = await apiFetch<{ added: number; skipped: number; failed: number }>(`/v1/projects/${pid}/contacts/import`, {
        method: "POST",
        body: JSON.stringify({ rows, source: "Excel import" }),
      });
      setResult(res);
      await onImported();
    } catch (e) {
      setError(e instanceof ApiError && e.status === 403 ? "You have view-only access and can't import leads." : "Couldn't import leads.");
    } finally {
      setImporting(false);
    }
  }

  const rowCount = sheet ? applyColumnMapping(sheet, mapping ?? guessColumnMapping(sheet.headers)).length : 0;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        {!sheet && (
          <>
            <DialogHeader>
              <DialogTitle>Import leads from Excel</DialogTitle>
              <DialogDescription>Upload an .xlsx, .xls, or .csv file with a header row.</DialogDescription>
            </DialogHeader>
            <label
              htmlFor="excel-file"
              className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-6 py-10 text-center transition-colors hover:bg-muted/50"
            >
              <FileUp className="h-7 w-7 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">Click to choose a file</span>
              <span className="text-xs text-muted-foreground">.xlsx, .xls, or .csv</span>
              <input
                id="excel-file"
                type="file"
                accept=".xlsx,.xls,.csv"
                className="sr-only"
                onChange={(e) => e.target.files?.[0] && onFileSelected(e.target.files[0])}
              />
            </label>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
            </DialogFooter>
          </>
        )}

        {sheet && mapping && !result && (
          <>
            <DialogHeader>
              <DialogTitle>Map your columns</DialogTitle>
              <DialogDescription>
                We matched what we could — adjust any that look wrong. <b className="text-foreground">{rowCount}</b> row(s) will be imported.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-3">
              {CONTACT_FIELDS.map((field) => (
                <div key={field.key} className="grid grid-cols-[150px_1fr] items-center gap-3">
                  <span className="text-sm font-medium text-foreground">
                    {field.label}
                    {field.required && <span className="text-destructive"> *</span>}
                  </span>
                  <Select value={mapping[field.key] ?? ""} onChange={(e) => setMapping({ ...mapping, [field.key]: e.target.value || null })}>
                    <option value="">— not mapped —</option>
                    {sheet.headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </Select>
                </div>
              ))}
            </div>
            {!mapping.name && <p className="text-sm text-destructive">Business name must be mapped to import.</p>}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button variant="outline" onClick={() => { setSheet(null); setMapping(null); }} disabled={importing}>
                Choose a different file
              </Button>
              <Button variant="outline" onClick={onClose} disabled={importing}>
                Cancel
              </Button>
              <Button onClick={confirmImport} disabled={!mapping.name || importing}>
                <Upload className="h-4 w-4" />
                {importing ? "Importing…" : `Import ${rowCount} lead(s)`}
              </Button>
            </DialogFooter>
          </>
        )}

        {result && (
          <>
            <DialogHeader>
              <DialogTitle>Import complete</DialogTitle>
              <DialogDescription>
                <b className="text-foreground">{result.added}</b> lead(s) added, <b className="text-foreground">{result.skipped}</b> skipped as
                duplicates, <b className="text-foreground">{result.failed}</b> failed.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button onClick={onClose}>Done</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
