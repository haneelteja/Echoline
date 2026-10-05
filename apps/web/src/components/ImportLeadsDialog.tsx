"use client";
import { useRef, useState } from "react";
import { apiFetch, ApiError } from "@/lib/apiClient";
import {
  applyColumnMapping,
  CONTACT_FIELDS,
  guessColumnMapping,
  parseExcelFile,
  type ContactFieldKey,
  type ParsedSheet,
} from "@/lib/excelImport";

interface Props {
  pid: string;
  onClose: () => void;
  onImported: () => Promise<void>;
}

export function ImportLeadsDialog({ pid, onClose, onImported }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
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
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {!sheet && (
          <>
            <h2>Import leads from Excel</h2>
            <p className="small muted">Upload an .xlsx, .xls, or .csv file with a header row.</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => e.target.files?.[0] && onFileSelected(e.target.files[0])}
              style={{ marginTop: 14 }}
            />
            {error && (
              <p className="small" style={{ color: "var(--bad)", marginTop: 10 }}>
                {error}
              </p>
            )}
            <div className="row" style={{ marginTop: 18 }}>
              <button className="btn" onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        )}

        {sheet && mapping && !result && (
          <>
            <h2>Map your columns</h2>
            <p className="small muted">
              We matched what we could from &quot;{sheet.headers.join(", ")}&quot; — adjust any that look wrong. {rowCount} row(s) will be
              imported.
            </p>
            <div style={{ marginTop: 16 }}>
              {CONTACT_FIELDS.map((field) => (
                <div className="map-row" key={field.key}>
                  <label>
                    {field.label}
                    {field.required && " *"}
                  </label>
                  <select
                    value={mapping[field.key] ?? ""}
                    onChange={(e) => setMapping({ ...mapping, [field.key]: e.target.value || null })}
                  >
                    <option value="">— not mapped —</option>
                    {sheet.headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            {!mapping.name && (
              <p className="small" style={{ color: "var(--bad)" }}>
                Business name must be mapped to import.
              </p>
            )}
            {error && (
              <p className="small" style={{ color: "var(--bad)", marginTop: 10 }}>
                {error}
              </p>
            )}
            <div className="row" style={{ marginTop: 18 }}>
              <button className="btn primary" onClick={confirmImport} disabled={!mapping.name || importing}>
                {importing ? "Importing…" : `Import ${rowCount} lead(s)`}
              </button>
              <button
                className="btn"
                onClick={() => {
                  setSheet(null);
                  setMapping(null);
                }}
                disabled={importing}
              >
                Choose a different file
              </button>
              <button className="btn" onClick={onClose} disabled={importing}>
                Cancel
              </button>
            </div>
          </>
        )}

        {result && (
          <>
            <h2>Import complete</h2>
            <p>
              <b>{result.added}</b> lead(s) added, <b>{result.skipped}</b> skipped as duplicates, <b>{result.failed}</b> failed.
            </p>
            <div className="row" style={{ marginTop: 18 }}>
              <button className="btn primary" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
