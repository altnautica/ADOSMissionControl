"use client";

/**
 * Universal log import modal — auto-detects .bin / .ulg / .tlog / .json
 * by magic bytes and dispatches to the appropriate parser.
 *
 * @license GPL-3.0-only
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Upload, Check, AlertCircle, X, FileType } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/progress-bar";
import { detectFlightLogFormat, importFlightLog, type FlightLogFormat } from "@/lib/flight-log-import";

interface ParsedFile {
  file: File;
  format: FlightLogFormat;
  status: "pending" | "importing" | "done" | "error";
  /** Fraction parsed while importing, 0..1. */
  progress?: number;
  flightCount?: number;
  duplicates?: number;
  error?: string;
}

const FORMAT_LABELS: Record<FlightLogFormat, string> = {
  bin: "ArduPilot (.bin)",
  ulg: "PX4 ULog (.ulg)",
  tlog: "MAVLink (.tlog)",
  json: "ADOS JSON",
  unknown: "Unknown",
};

const FORMAT_COLORS: Record<FlightLogFormat, string> = {
  bin: "text-accent-primary",
  ulg: "text-status-success",
  tlog: "text-status-warning",
  json: "text-text-secondary",
  unknown: "text-status-error",
};

interface ImportLogModalProps {
  open: boolean;
  onClose: () => void;
}

/** Mounts the dialog body only while open, so every opening starts fresh. */
export function ImportLogModal({ open, onClose }: ImportLogModalProps) {
  if (!open) return null;
  return <ImportLogDialog onClose={onClose} />;
}

function ImportLogDialog({ onClose }: { onClose: () => void }) {
  const [files, setFiles] = useState<ParsedFile[]>([]);
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState(false);
  // The running import's controller; a ref so a second click before the
  // re-render cannot start a parallel run over the same files.
  const runRef = useRef<AbortController | null>(null);

  // Closing the dialog cancels the parse in flight.
  useEffect(() => () => runRef.current?.abort(), []);

  const handleFiles = useCallback(async (fileList: FileList | File[]) => {
    const arr = Array.from(fileList);
    const parsed: ParsedFile[] = [];

    for (const file of arr) {
      const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
      const format = detectFlightLogFormat(header, file.name);
      parsed.push({ file, format, status: "pending" });
    }

    setDone(false);
    setFiles((prev) => [...prev, ...parsed]);
  }, []);

  const handleImport = useCallback(async () => {
    if (runRef.current) return;
    const run = new AbortController();
    runRef.current = run;
    setImporting(true);
    // Only files not yet attempted: earlier imports stay as they are.
    const queue = files.flatMap((pf, i) => (pf.status === "pending" ? [i] : []));
    const setStatus = (i: number, patch: Partial<ParsedFile>) =>
      setFiles((prev) => prev.map((f, j) => (j === i ? { ...f, ...patch } : f)));

    try {
      for (const i of queue) {
        if (run.signal.aborted) break;
        const pf = files[i];
        if (pf.format === "unknown") {
          setStatus(i, { status: "error", error: "Unknown format" });
          continue;
        }
        setStatus(i, { status: "importing", progress: 0 });
        try {
          const bytes = new Uint8Array(await pf.file.arrayBuffer());
          const result = await importFlightLog(bytes, {
            filename: pf.file.name,
            onProgress: (fraction) => setStatus(i, { progress: fraction }),
            signal: run.signal,
          });
          setStatus(i, { status: "done", flightCount: result.flightsImported, duplicates: result.duplicates });
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") {
            // Cancelled: nothing was added, so the file can be imported again.
            setStatus(i, { status: "pending", progress: undefined });
            break;
          }
          setStatus(i, { status: "error", error: err instanceof Error ? err.message : String(err) });
        }
      }
    } finally {
      runRef.current = null;
      setImporting(false);
      if (!run.signal.aborted) setDone(true);
    }
  }, [files]);

  const handleCancel = useCallback(() => runRef.current?.abort(), []);

  const importableCount = files.filter((f) => f.format !== "unknown" && f.status === "pending").length;
  const importedFlights = files.reduce((n, f) => n + (f.status === "done" ? (f.flightCount ?? 0) : 0), 0);
  const failedCount = files.filter((f) => f.status === "error").length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/70 backdrop-blur-sm">
      <div className="w-[600px] max-w-[95vw] max-h-[80vh] overflow-y-auto rounded-md border border-border-default bg-bg-secondary shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
          <h3 className="text-xs font-semibold text-text-primary uppercase tracking-wider">
            Import Flight Logs
          </h3>
          <button onClick={onClose} className="text-text-tertiary hover:text-text-primary p-1">
            <X size={14} />
          </button>
        </div>

        <div className="p-4 flex flex-col gap-3">
          {!importing && (
            <div
              onDrop={(e) => { e.preventDefault(); void handleFiles(e.dataTransfer.files); }}
              onDragOver={(e) => e.preventDefault()}
              className="border-2 border-dashed border-border-default rounded-md p-8 text-center hover:border-accent-primary transition-colors cursor-pointer"
              onClick={() => {
                const input = document.createElement("input");
                input.type = "file";
                input.multiple = true;
                input.accept = ".bin,.ulg,.ulog,.tlog,.json";
                input.onchange = () => { if (input.files) void handleFiles(input.files); };
                input.click();
              }}
            >
              <Upload size={24} className="mx-auto text-text-tertiary mb-2" />
              <p className="text-xs text-text-secondary">Drop log files here, or click to browse</p>
              <p className="text-[10px] text-text-tertiary mt-1">
                ArduPilot .bin · PX4 .ulg · MAVLink .tlog · ADOS .json
              </p>
            </div>
          )}

          {done && (
            <div className="flex items-center gap-2 text-xs text-text-primary">
              {failedCount > 0 ? (
                <AlertCircle size={14} className="text-status-error shrink-0" />
              ) : (
                <Check size={14} className="text-status-success shrink-0" />
              )}
              <span>
                Import complete: {importedFlights} flight{importedFlights !== 1 ? "s" : ""} added
                {failedCount > 0 ? `, ${failedCount} file${failedCount !== 1 ? "s" : ""} failed` : ""}.
              </span>
            </div>
          )}

          {files.length > 0 && (
            <Card title={`${files.length} file${files.length > 1 ? "s" : ""}`} padding={true}>
              <div className="flex flex-col gap-1 max-h-[200px] overflow-y-auto">
                {files.map((pf, i) => (
                  <div key={i} className="flex items-center gap-2 text-[10px]">
                    <FileType size={10} className={FORMAT_COLORS[pf.format]} />
                    <span className="text-text-primary truncate flex-1">{pf.file.name}</span>
                    <span className={`shrink-0 ${FORMAT_COLORS[pf.format]}`}>
                      {FORMAT_LABELS[pf.format]}
                    </span>
                    {pf.status === "done" && (
                      <span className="text-status-success shrink-0">
                        <Check size={10} className="inline" /> {pf.flightCount} flight{pf.flightCount !== 1 ? "s" : ""}
                        {pf.duplicates ? ` · ${pf.duplicates} already in history` : ""}
                      </span>
                    )}
                    {pf.status === "error" && (
                      <span className="text-status-error shrink-0">
                        <AlertCircle size={10} className="inline" /> {pf.error}
                      </span>
                    )}
                    {pf.status === "importing" && (
                      <ProgressBar
                        value={(pf.progress ?? 0) * 100}
                        color="var(--alt-accent-primary)"
                        showLabel
                        label={`Importing ${pf.file.name}`}
                        className="w-32 shrink-0"
                      />
                    )}
                  </div>
                ))}
              </div>
              <div className="flex justify-end gap-2 mt-2 pt-2 border-t border-border-default">
                {importing ? (
                  <Button variant="secondary" size="sm" onClick={handleCancel}>
                    Cancel
                  </Button>
                ) : importableCount > 0 ? (
                  <Button variant="primary" size="sm" onClick={() => void handleImport()}>
                    Import {importableCount} file{importableCount !== 1 ? "s" : ""}
                  </Button>
                ) : (
                  <Button variant="secondary" size="sm" onClick={onClose}>
                    Close
                  </Button>
                )}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
