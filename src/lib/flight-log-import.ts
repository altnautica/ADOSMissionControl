/**
 * Format detection and import for flight log files.
 *
 * One entry point for every source of log bytes (file drop, onboard log
 * download): the format is detected from the magic bytes, falling back to the
 * file extension, and the bytes are routed to the matching importer. Binary
 * logs parse in a Web Worker with progress and cancel. Records already in the
 * history store (same id) are not imported twice; binary log ids derive from
 * the log's content, so the same file always yields the same ids.
 *
 * @module flight-log-import
 * @license GPL-3.0-only
 */

import { useHistoryStore } from "@/stores/history-store";
import { setRecordingFromFrames, type TelemetryFrame } from "@/lib/telemetry-recorder";
import { importDataflashLog } from "@/lib/dataflash/import";
import { buildFlightLogOffThread } from "@/lib/flight-log-build";
import type { FlightRecord } from "@/lib/types";

export type FlightLogFormat = "bin" | "ulg" | "tlog" | "json" | "unknown";

export function detectFlightLogFormat(header: Uint8Array, filename: string): FlightLogFormat {
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

export interface FlightLogImportOptions {
  filename: string;
  /** Attribute the imported flights to this drone instead of the log's own hint. */
  droneId?: string;
  droneName?: string;
  /** Fraction of a binary log parsed, 0..1. */
  onProgress?: (fraction: number) => void;
  /** Aborting cancels the parse; the import rejects with an `AbortError` and adds nothing. */
  signal?: AbortSignal;
}

export interface FlightLogImportResult {
  format: FlightLogFormat;
  /** Flights newly added to history. */
  flightsImported: number;
  /** Flights found in the log that were already in history. */
  duplicates: number;
  /** Dataflash only: the log carries no RC input rows. */
  rcInMissing: boolean;
}

/**
 * Store the recording (when there is one), then add the record; false for a
 * duplicate. The record is added only once its telemetry is stored.
 */
async function ingest(record: FlightRecord, frames: TelemetryFrame[]): Promise<boolean> {
  if (useHistoryStore.getState().records.some((r) => r.id === record.id)) return false;
  if (record.recordingId && frames.length > 0) {
    await setRecordingFromFrames(record.recordingId, record.droneName, frames, {
      droneId: record.droneId,
      droneName: record.droneName,
      startTimeMs: record.startTime,
    });
  }
  return useHistoryStore.getState().addRecord(record);
}

/**
 * Detect the format of `bytes` and import every flight it holds. Throws on a
 * corrupt log, an unrecognised format or a cancelled import; a readable log
 * with no flight in it resolves with `flightsImported: 0`.
 */
export async function importFlightLog(
  bytes: Uint8Array,
  options: FlightLogImportOptions,
): Promise<FlightLogImportResult> {
  const format = detectFlightLogFormat(bytes.subarray(0, 16), options.filename);
  if (format === "unknown") throw new Error("Unknown log format");
  const run = { onProgress: options.onProgress, signal: options.signal };
  if (format === "bin") {
    const summary = await importDataflashLog(
      bytes,
      { sourceFilename: options.filename, droneId: options.droneId, droneName: options.droneName },
      run,
    );
    return {
      format,
      flightsImported: summary.flightsImported,
      duplicates: summary.duplicates,
      rcInMissing: summary.rcInMissing,
    };
  }

  const attribute = (record: FlightRecord): FlightRecord => ({
    ...record,
    droneId: options.droneId ?? record.droneId,
    droneName: options.droneName ?? record.droneName,
  });
  let found: { record: FlightRecord; frames: TelemetryFrame[] }[] = [];
  if (format === "ulg" || format === "tlog") {
    const flights = await buildFlightLogOffThread(format, bytes, options.filename, run);
    found = flights.map((f) => ({ record: attribute(f.record), frames: f.frames }));
  } else {
    const data: unknown = JSON.parse(new TextDecoder().decode(bytes));
    const rows = (Array.isArray(data) ? data : [data]) as Partial<FlightRecord>[];
    found = rows
      .filter((rec): rec is FlightRecord => !!rec && typeof rec.id === "string" && typeof rec.droneName === "string")
      .map((rec) => ({ record: { ...rec, source: "imported", updatedAt: Date.now() }, frames: [] }));
  }
  options.signal?.throwIfAborted();

  let flightsImported = 0;
  try {
    for (const { record, frames } of found) {
      if (await ingest(record, frames)) flightsImported++;
    }
  } finally {
    if (flightsImported > 0) await useHistoryStore.getState().persistToIDB();
  }
  return { format, flightsImported, duplicates: found.length - flightsImported, rcInMissing: false };
}
