"use client";

/**
 * Elapsed time of the running flight recording, as m:ss.
 *
 * The start stamp comes from the recording stores, so leaving the cockpit and
 * coming back resumes the count instead of restarting it. This component is
 * the only thing that ticks: it subscribes to the shared 1 Hz clock, so a
 * running recording re-renders these few characters once a second and
 * nothing around them.
 *
 * @license GPL-3.0-only
 */

import { useClockTick } from "@/lib/agent/freshness";
import { useFlightRecordingStartedAt } from "@/hooks/use-flight-recording";
import { formatElapsed, msSince } from "./band/format";

export function RecTimer({ droneId }: { droneId: string }) {
  const startedAt = useFlightRecordingStartedAt(droneId);
  useClockTick();
  if (startedAt === null) return null;
  return (
    <span className="tabular-nums" data-testid="cockpit-rec-timer">
      {formatElapsed(msSince(startedAt))}
    </span>
  );
}
