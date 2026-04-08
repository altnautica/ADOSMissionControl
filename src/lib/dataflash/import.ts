/**
 * Top-level dataflash import orchestrator.
 *
 * Takes raw `.bin` bytes (from FC download or disk drag-drop), parses, splits
 * into FlightRecords, persists frames into the recordings IDB store, and
 * inserts each record into the history store.
 *
 * Returns a small summary the UI can show in a toast.
 *
 * @module dataflash/import
 * @license GPL-3.0-only
 */

import { parseDataflashLog, type DataflashLog } from "./parser";
import { dataflashToFlightRecords } from "./to-flight-record";
import { setRecordingFromFrames } from "@/lib/telemetry-recorder";
import { useHistoryStore } from "@/stores/history-store";

export interface DataflashImportSummary {
  flightsImported: number;
  bytesParsed: number;
  resyncSkipped: number;
  /** True if the LOG_BITMASK didn't include RC stick inputs. */
  rcInMissing: boolean;
  /** Total parameters parsed from PARM rows. */
  paramCount: number;
}

export interface DataflashImportOptions {
  /** Original filename (e.g. `00000123.BIN`). */
  sourceFilename?: string;
  /** Drone id to attribute the imported flights to. Defaults to a sysid hint. */
  droneId?: string;
  droneName?: string;
}

/**
 * Parse a `.bin` buffer and ingest its flights.
 *
 * Throws on a corrupt log; any thrown error should surface in the UI as an
 * error toast.
 */
export async function importDataflashLog(
  buffer: Uint8Array,
  options: DataflashImportOptions = {},
): Promise<DataflashImportSummary> {
  const log: DataflashLog = parseDataflashLog(buffer);

  const built = dataflashToFlightRecords(log, options);
  if (built.length === 0) {
    return {
      flightsImported: 0,
      bytesParsed: log.bytesRead,
      resyncSkipped: log.resyncSkipped,
      rcInMissing: (log.messages.get("RCIN") ?? []).length === 0,
      paramCount: log.params.size,
    };
  }

  const history = useHistoryStore.getState();

  for (const flight of built) {
    if (flight.frames.length > 0) {
      await setRecordingFromFrames(
        flight.record.recordingId!,
        flight.record.sourceFilename
          ? `Dataflash · ${flight.record.sourceFilename}`
          : "Dataflash import",
        flight.frames,
        {
          droneId: flight.record.droneId,
          droneName: flight.record.droneName,
          startTimeMs: flight.record.startTime,
        },
      );
    }
    history.addRecord(flight.record);
  }
  await history.persistToIDB();

  return {
    flightsImported: built.length,
    bytesParsed: log.bytesRead,
    resyncSkipped: log.resyncSkipped,
    rcInMissing: (log.messages.get("RCIN") ?? []).length === 0,
    paramCount: log.params.size,
  };
}
