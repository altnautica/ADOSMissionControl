"use client";

/**
 * Media Uploader — drag-drop photos/videos, read EXIF, auto-link to flights.
 *
 * Phase 20a — photo/video EXIF auto-link.
 *
 * @license GPL-3.0-only
 */

import { useCallback, useState } from "react";
import { set as idbSet } from "idb-keyval";
import { Upload, Check, AlertCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useHistoryStore } from "@/stores/history-store";
import type { FlightMedia, FlightRecord } from "@/lib/types";

const ACCEPTED_TYPES = new Set([
  "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif",
  "video/mp4", "video/quicktime", "video/webm",
]);

interface ParsedMedia {
  file: File;
  capturedAt: number;
  lat?: number;
  lon?: number;
  alt?: number;
  matchedFlightId?: string;
  matchedFlightName?: string;
}

interface MediaUploaderProps {
  open: boolean;
  onClose: () => void;
}

export function MediaUploader({ open, onClose }: MediaUploaderProps) {
  const [parsed, setParsed] = useState<ParsedMedia[]>([]);
  const [importing, setImporting] = useState(false);
  const [done, setDone] = useState(false);
  const records = useHistoryStore((s) => s.records);

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const fileArr = Array.from(files).filter((f) => ACCEPTED_TYPES.has(f.type));
      if (fileArr.length === 0) return;

      // Dynamic import exifr to avoid SSR issues
      const exifr = await import("exifr");

      const results: ParsedMedia[] = [];
      for (const file of fileArr) {
        let capturedAt = file.lastModified;
        let lat: number | undefined;
        let lon: number | undefined;
        let alt: number | undefined;

        try {
          const exif = await exifr.parse(file, {
            pick: ["DateTimeOriginal", "CreateDate", "GPSLatitude", "GPSLongitude", "GPSAltitude"],
          });
          if (exif) {
            if (exif.DateTimeOriginal instanceof Date) {
              capturedAt = exif.DateTimeOriginal.getTime();
            } else if (exif.CreateDate instanceof Date) {
              capturedAt = exif.CreateDate.getTime();
            }
            if (typeof exif.latitude === "number") lat = exif.latitude;
            if (typeof exif.longitude === "number") lon = exif.longitude;
            if (typeof exif.GPSAltitude === "number") alt = exif.GPSAltitude;
          }
        } catch {
          // No EXIF — use file modification time
        }

        // Match to flight by timestamp window (within flight start/end ±60s)
        const match = findMatchingFlight(records, capturedAt);

        results.push({
          file,
          capturedAt,
          lat,
          lon,
          alt,
          matchedFlightId: match?.id,
          matchedFlightName: match?.customName ?? match?.droneName,
        });
      }

      setParsed((prev) => [...prev, ...results]);
    },
    [records],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      void handleFiles(e.dataTransfer.files);
    },
    [handleFiles],
  );

  const handleImport = useCallback(async () => {
    setImporting(true);
    const store = useHistoryStore.getState();

    // Group by matched flight
    const byFlight = new Map<string, ParsedMedia[]>();
    for (const p of parsed) {
      if (!p.matchedFlightId) continue;
      const arr = byFlight.get(p.matchedFlightId) ?? [];
      arr.push(p);
      byFlight.set(p.matchedFlightId, arr);
    }

    for (const [flightId, mediaItems] of byFlight) {
      const newMedia: FlightMedia[] = [];
      for (const item of mediaItems) {
        const id = crypto.randomUUID();
        const blobKey = `media:${flightId}:${id}`;

        // Store blob in IDB
        const buffer = await item.file.arrayBuffer();
        await idbSet(blobKey, new Blob([buffer], { type: item.file.type }));

        newMedia.push({
          id,
          name: item.file.name,
          type: item.file.type,
          size: item.file.size,
          capturedAt: item.capturedAt,
          lat: item.lat,
          lon: item.lon,
          alt: item.alt,
          blobKey,
        });
      }

      const existing = store.records.find((r) => r.id === flightId)?.media ?? [];
      store.updateRecord(flightId, { media: [...existing, ...newMedia] });
    }

    await store.persistToIDB();
    setImporting(false);
    setDone(true);
  }, [parsed]);

  const matchedCount = parsed.filter((p) => p.matchedFlightId).length;
  const unmatchedCount = parsed.length - matchedCount;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-[600px] max-w-[95vw] max-h-[80vh] overflow-y-auto rounded-md border border-border-default bg-bg-secondary shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
          <h3 className="text-xs font-semibold text-text-primary uppercase tracking-wider">
            Import Media
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
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                className="border-2 border-dashed border-border-default rounded-md p-8 text-center hover:border-accent-primary transition-colors cursor-pointer"
                onClick={() => {
                  const input = document.createElement("input");
                  input.type = "file";
                  input.multiple = true;
                  input.accept = "image/*,video/*";
                  input.onchange = () => {
                    if (input.files) void handleFiles(input.files);
                  };
                  input.click();
                }}
              >
                <Upload size={24} className="mx-auto text-text-tertiary mb-2" />
                <p className="text-xs text-text-secondary">
                  Drop photos or videos here, or click to browse
                </p>
                <p className="text-[10px] text-text-tertiary mt-1">
                  JPEG, PNG, WebP, HEIC, MP4, MOV, WebM
                </p>
              </div>

              {/* Parsed files summary */}
              {parsed.length > 0 && (
                <Card title={`${parsed.length} files`} padding={true}>
                  <div className="flex flex-col gap-1 max-h-[200px] overflow-y-auto">
                    {parsed.map((p, i) => (
                      <div key={i} className="flex items-center gap-2 text-[10px]">
                        {p.matchedFlightId ? (
                          <Check size={10} className="text-status-success shrink-0" />
                        ) : (
                          <AlertCircle size={10} className="text-status-warning shrink-0" />
                        )}
                        <span className="text-text-primary truncate flex-1">{p.file.name}</span>
                        <span className="text-text-tertiary shrink-0">
                          {new Date(p.capturedAt).toLocaleString()}
                        </span>
                        {p.matchedFlightId ? (
                          <span className="text-status-success shrink-0">→ {p.matchedFlightName}</span>
                        ) : (
                          <span className="text-status-warning shrink-0">No match</span>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-border-default">
                    <span className="text-[10px] text-text-tertiary">
                      {matchedCount} matched · {unmatchedCount} unmatched
                    </span>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => void handleImport()}
                      disabled={matchedCount === 0 || importing}
                    >
                      {importing ? "Importing…" : `Import ${matchedCount} files`}
                    </Button>
                  </div>
                </Card>
              )}
            </>
          ) : (
            <div className="text-center py-8">
              <Check size={24} className="mx-auto text-status-success mb-2" />
              <p className="text-xs text-text-primary">
                {matchedCount} files imported successfully.
              </p>
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

/** Find a flight whose time window contains the given timestamp (±60s buffer). */
function findMatchingFlight(
  records: FlightRecord[],
  timestampMs: number,
): FlightRecord | undefined {
  const BUFFER_MS = 60_000;
  return records.find((r) => {
    const start = (r.startTime ?? r.date) - BUFFER_MS;
    const end = (r.endTime ?? r.startTime ?? r.date) + BUFFER_MS;
    return timestampMs >= start && timestampMs <= end;
  });
}
