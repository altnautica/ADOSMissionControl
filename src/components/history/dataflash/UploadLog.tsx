"use client";

/**
 * Drag-drop `.bin` dataflash file importer.
 *
 * Same parser path as the LogBrowser, just sourced from disk instead of the
 * MAVLink LOG_REQUEST_DATA pipeline. Supports multi-file drop and the
 * standard "click to browse" fallback.
 *
 * @license GPL-3.0-only
 */

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { X, Upload, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { importDataflashLog, type DataflashImportSummary } from "@/lib/dataflash/import";

interface UploadLogProps {
  open: boolean;
  onClose: () => void;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function UploadLog({ open, onClose }: UploadLogProps) {
  const t = useTranslations("history");
  const [busy, setBusy] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<{ filename: string; result: DataflashImportSummary }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    setError(null);
    const list = Array.from(files).filter((f) => /\.bin$/i.test(f.name));
    if (list.length === 0) {
      setError("No .bin files in selection");
      return;
    }
    const results: { filename: string; result: DataflashImportSummary }[] = [];
    try {
      for (const file of list) {
        setBusy(file.name);
        const buffer = new Uint8Array(await file.arrayBuffer());
        const result = await importDataflashLog(buffer, { sourceFilename: file.name });
        results.push({ filename: file.name, result });
      }
      setSummaries((prev) => [...prev, ...results]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLLabelElement>) => {
      e.preventDefault();
      setDragging(false);
      void handleFiles(e.dataTransfer.files);
    },
    [handleFiles],
  );

  const onPick = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) void handleFiles(e.target.files);
    },
    [handleFiles],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-[520px] max-w-[95vw] max-h-[85vh] overflow-y-auto rounded-md border border-border-default bg-bg-secondary shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default sticky top-0 bg-bg-secondary z-10">
          <h3 className="text-xs font-semibold text-text-primary uppercase tracking-wider">
            {t("uploadLogTitle")}
          </h3>
          <button
            onClick={onClose}
            className="text-text-tertiary hover:text-text-primary transition-colors p-1"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        <div className="p-4 flex flex-col gap-3">
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={`flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed px-6 py-10 text-center cursor-pointer transition-colors ${
              dragging ? "border-accent-primary bg-accent-primary/5" : "border-border-default hover:border-accent-primary/60"
            }`}
          >
            <Upload size={20} className="text-text-tertiary" />
            <span className="text-xs text-text-secondary">{t("uploadLogDrop")}</span>
            <input
              type="file"
              accept=".bin,application/octet-stream"
              multiple
              className="hidden"
              onChange={onPick}
            />
          </label>

          {busy && (
            <p className="text-[11px] text-text-secondary">{t("uploadLogProcessing", { filename: busy })}</p>
          )}

          {error && (
            <div className="rounded border border-status-error/40 bg-status-error/10 px-3 py-2 text-[11px] text-status-error flex items-start gap-2">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              {t("logBrowserParseError", { message: error })}
            </div>
          )}

          {summaries.length > 0 && (
            <div className="flex flex-col gap-2">
              {summaries.map((s, i) => (
                <div
                  key={`${s.filename}-${i}`}
                  className="rounded border border-status-success/40 bg-status-success/10 px-3 py-2 text-[11px] text-text-secondary"
                >
                  <div className="flex items-center gap-2">
                    <Badge variant="success" size="sm">✓</Badge>
                    <span className="font-mono">{s.filename}</span>
                  </div>
                  <p className="mt-1">
                    {t("logBrowserSuccess", {
                      flights: s.result.flightsImported,
                      bytes: fmtBytes(s.result.bytesParsed),
                    })}
                  </p>
                  {s.result.rcInMissing && (
                    <p className="mt-1 text-text-tertiary">{t("logBrowserRcInMissing")}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              {t("clear")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
