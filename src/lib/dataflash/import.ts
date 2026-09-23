/**
 * Top-level dataflash import orchestrator.
 *
 * Takes raw `.bin` bytes (from FC download or disk drag-drop), parses and
 * splits them into FlightRecords off the main thread, persists frames into
 * the recordings IDB store, and inserts each new record into the history
 * store.
 *
 * Returns a small summary the UI can show in a toast.
 *
 * @module dataflash/import
 * @license GPL-3.0-only
 */

import { buildDataflashFlightsOffThread } from "./build";
import type { DataflashConvertOptions } from "./to-flight-record";
import { setRecordingFromFrames } from "@/lib/telemetry-recorder";
import { useHistoryStore } from "@/stores/history-store";

export interface DataflashImportSummary {
  /** Flights newly added to history. */
  flightsImported: number;
  /** Flights in the log that history already holds (same id), left untouched. */
  duplicates: number;
  bytesParsed: number;
  resyncSkipped: number;
  /** True if the LOG_BITMASK didn't include RC stick inputs. */
  rcInMissing: boolean;
  /** Total parameters parsed from PARM rows. */
  paramCount: number;
}

/**
 * Parse a `.bin` buffer and ingest its flights.
 *
 * Throws on a corrupt log; any thrown error should surface in the UI as an
 * error toast.
 */
export async function importDataflashLog(
  buffer: Uint8Array,
  options: DataflashConvertOptions = {},
): Promise<DataflashImportSummary> {
  const build = await buildDataflashFlightsOffThread(buffer, options);
  const history = useHistoryStore.getState();

  let flightsImported = 0;
  for (const flight of build.flights) {
    // A re-import of the same log yields the same ids; keep what is stored.
    if (!history.addRecord(flight.record)) continue;
    flightsImported++;
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
  }
  if (flightsImported > 0) await history.persistToIDB();

  return {
    flightsImported,
    duplicates: build.flights.length - flightsImported,
    bytesParsed: build.bytesRead,
    resyncSkipped: build.resyncSkipped,
    rcInMissing: build.rcInMissing,
    paramCount: build.paramCount,
  };
}
