/**
 * Re-run the flight analyzer over a record's stored telemetry recording.
 *
 * Shared by the Events and Analysis tabs. A missing recording (evicted by the
 * recorder's retention, or never stored) leaves the stored results alone and
 * reports the recording as unavailable. Operator-authored events, such as the
 * "Record unsealed" entry, survive a re-run: only analyzer output is replaced.
 *
 * @license GPL-3.0-only
 */

import { useState } from "react";
import { loadRecordingFrames } from "@/lib/telemetry-recorder";
import { analyzeFlight } from "@/lib/flight-analysis/analyzer";
import { useHistoryStore } from "@/stores/history-store";
import type { FlightEvent, FlightRecord } from "@/lib/types";

/** Event type of operator-authored entries (notes, the "Record unsealed" entry). */
export const MANUAL_EVENT_TYPE = "manual_note";

/** Analyzer events plus every operator-authored event already on the record. */
export function mergeAnalyzerEvents(
  existing: FlightEvent[] | undefined,
  analyzed: FlightEvent[],
): FlightEvent[] {
  const manual = (existing ?? []).filter((e) => e.type === MANUAL_EVENT_TYPE);
  return [...analyzed, ...manual];
}

export interface Reanalysis {
  running: boolean;
  /** The last attempt found no stored frames for this record. */
  recordingMissing: boolean;
  run: () => Promise<void>;
}

export function useReanalysis(record: FlightRecord): Reanalysis {
  const [running, setRunning] = useState(false);
  const [missingFor, setMissingFor] = useState<string | null>(null);

  const run = async () => {
    if (!record.recordingId) return;
    setRunning(true);
    try {
      const frames = await loadRecordingFrames(record.recordingId);
      if (frames.length === 0) {
        setMissingFor(record.recordingId);
        return;
      }
      setMissingFor(null);
      const result = analyzeFlight(frames);
      const store = useHistoryStore.getState();
      const live = store.records.find((r) => r.id === record.id);
      store.updateRecord(record.id, {
        events: mergeAnalyzerEvents(live?.events, result.events),
        flags: result.flags,
        health: result.health,
      });
      void store.persistToIDB();
    } finally {
      setRunning(false);
    }
  };

  return {
    running,
    recordingMissing: missingFor !== null && missingFor === record.recordingId,
    run,
  };
}
