"use client";

/**
 * Universal log import modal — auto-detects .bin / .ulg / .tlog / .json
 * by magic bytes and dispatches to the appropriate parser.
 *
 * Phase 30.
 *
 * @license GPL-3.0-only
 */

import { useCallback, useState } from "react";
import { Upload, Check, AlertCircle, X, FileType } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useHistoryStore } from "@/stores/history-store";
import { setRecordingFromFrames } from "@/lib/telemetry-recorder";

type DetectedFormat = "bin" | "ulg" | "tlog" | "json" | "unknown";

interface ParsedFile {
  file: File;
  format: DetectedFormat;
  status: "pending" | "importing" | "done" | "error";
  flightCount?: number;
  error?: string;
}

function detectFormat(header: Uint8Array, filename: string): DetectedFormat {
  // ArduPilot dataflash: starts with 0xA3 0x95
  if (header[0] === 0xa3 && header[1] === 0x95) return "bin";
  // PX4 ULog: starts with "ULog" (0x55 0x4C 0x6F 0x67)
  if (header[0] === 0x55 && header[1] === 0x4c && header[2] === 0x6f && header[3] === 0x67) return "ulg";
  // JSON: starts with { or [
  if (header[0] === 0x7b || header[0] === 0x5b) return "json";
  // tlog: starts with 8-byte timestamp then MAVLink STX (0xFE or 0xFD)
  if (header.length >= 9 && (header[8] === 0xfe || header[8] === 0xfd)) return "tlog";
  // Fallback by extension
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext === "bin") return "bin";
  if (ext === "ulg" || ext === "ulog") return "ulg";
  if (ext === "tlog") return "tlog";
  if (ext === "json") return "json";
  return "unknown";
}

const FORMAT_LABELS: Record<DetectedFormat, string> = {
  bin: "ArduPilot (.bin)",
  ulg: "PX4 ULog (.ulg)",
  tlog: "MAVLink (.tlog)",
  json: "ADOS JSON",
  unknown: "Unknown",
};

const FORMAT_COLORS: Record<DetectedFormat, string> = {
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

export function ImportLogModal({ open, onClose }: ImportLogModalProps) {
  const [files, setFiles] = useState<ParsedFile[]>([]);
  const [done, setDone] = useState(false);

  const handleFiles = useCallback(async (fileList: FileList | File[]) => {
    const arr = Array.from(fileList);
    const parsed: ParsedFile[] = [];

    for (const file of arr) {
      const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
      const format = detectFormat(header, file.name);
      parsed.push({ file, format, status: "pending" });
    }

    setFiles((prev) => [...prev, ...parsed]);
  }, []);

  const handleImport = useCallback(async () => {
    const store = useHistoryStore.getState();
    let totalFlights = 0;

    setFiles((prev) => prev.map((f) => ({ ...f, status: "importing" as const })));

    for (let i = 0; i < files.length; i++) {
      const pf = files[i];
      if (pf.format === "unknown") {
        setFiles((prev) => prev.map((f, j) => j === i ? { ...f, status: "error", error: "Unknown format" } : f));
        continue;
      }

      try {
        const buffer = await pf.file.arrayBuffer();
        let flightCount = 0;

        if (pf.format === "bin") {
          const { importDataflashLog } = await import("@/lib/dataflash/import");
          const summary = await importDataflashLog(new Uint8Array(buffer));
          flightCount = summary.flightsImported;
        } else if (pf.format === "ulg") {
          const { parseUlog } = await import("@/lib/ulog/parser");
          const { ulogToFlightRecords } = await import("@/lib/ulog/to-flight-record");
          const log = parseUlog(buffer);
          const flights = ulogToFlightRecords(log, pf.file.name);
          for (const { record, frames } of flights) {
            await setRecordingFromFrames(record.recordingId!, record.droneName, frames, {
              droneId: record.droneId,
            });
            store.addRecord(record);
          }
          flightCount = flights.length;
        } else if (pf.format === "tlog") {
          const { parseTlog, tlogToFlightRecord } = await import("@/lib/tlog/parser");
          const packets = parseTlog(buffer);
          const result = tlogToFlightRecord(packets, pf.file.name);
          if (result) {
            await setRecordingFromFrames(result.record.recordingId!, result.record.droneName, result.frames, {
              droneId: result.record.droneId,
            });
            store.addRecord(result.record);
            flightCount = 1;
          }
        } else if (pf.format === "json") {
          const text = new TextDecoder().decode(buffer);
          const data = JSON.parse(text);
          const records = Array.isArray(data) ? data : [data];
          for (const rec of records) {
            if (rec.id && rec.droneName) {
              store.addRecord({ ...rec, source: "imported", updatedAt: Date.now() });
              flightCount++;
            }
          }
        }

        totalFlights += flightCount;
        setFiles((prev) => prev.map((f, j) => j === i ? { ...f, status: "done", flightCount } : f));
      } catch (err) {
        setFiles((prev) => prev.map((f, j) => j === i ? { ...f, status: "error", error: (err as Error).message } : f));
      }
    }

    await store.persistToIDB();
    if (totalFlights > 0) setDone(true);
  }, [files]);

  if (!open) return null;

  const importableCount = files.filter((f) => f.format !== "unknown" && f.status === "pending").length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
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
          {!done ? (
            <>
              {/* Drop zone */}
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

              {/* File list */}
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
                          </span>
                        )}
                        {pf.status === "error" && (
                          <span className="text-status-error shrink-0">
                            <AlertCircle size={10} className="inline" /> {pf.error}
                          </span>
                        )}
                        {pf.status === "importing" && (
                          <span className="text-text-tertiary shrink-0">Importing…</span>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-end mt-2 pt-2 border-t border-border-default">
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => void handleImport()}
                      disabled={importableCount === 0}
                    >
                      Import {importableCount} file{importableCount !== 1 ? "s" : ""}
                    </Button>
                  </div>
                </Card>
              )}
            </>
          ) : (
            <div className="text-center py-8">
              <Check size={24} className="mx-auto text-status-success mb-2" />
              <p className="text-xs text-text-primary">Import complete.</p>
              <Button variant="secondary" size="sm" onClick={onClose} className="mt-3">
                Close
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
