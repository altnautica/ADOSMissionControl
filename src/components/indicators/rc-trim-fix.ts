/**
 * @module indicators/rc-trim-fix
 * @description Writes RCx_TRIM from the live stick position for the pre-arm
 * "RC not neutral" quick fix, reporting each channel's confirmed outcome.
 * @license GPL-3.0-only
 */

import { isFresh } from "@/lib/telemetry/freshness";
import { formatErrorMessage } from "@/lib/utils";
import type { DroneProtocol } from "@/lib/protocol/types/protocol";
import type { RcData } from "@/lib/types/telemetry";

export interface TrimOutcome {
  channel: number;
  /** The PWM value written, when the channel had a reading. */
  value: number | null;
  /** Whether the flight controller confirmed the write. */
  ok: boolean;
  /** Why the write did not land. */
  reason?: string;
}

export type TrimRun =
  /** No RC reading recent enough to take a trim from; nothing was written. */
  | { kind: "stale" }
  | { kind: "done"; outcomes: TrimOutcome[] };

/**
 * Set RCx_TRIM to the current stick value for each channel.
 *
 * The RC sample must be fresh: a trim taken from a reading that stopped
 * arriving would write whatever the stick was doing seconds ago. Each write's
 * result is checked, and a channel with no reading is reported as failed
 * rather than skipped.
 */
export async function applyRcTrims(
  protocol: Pick<DroneProtocol, "setParameter">,
  channels: readonly number[],
  sample: RcData | undefined,
  now: number,
): Promise<TrimRun> {
  if (!sample || !isFresh(sample.timestamp, now)) return { kind: "stale" };
  const outcomes: TrimOutcome[] = [];
  for (const channel of channels) {
    const value = sample.channels[channel - 1];
    if (value === undefined || !(value > 0)) {
      outcomes.push({ channel, value: null, ok: false, reason: "no RC reading for this channel" });
      continue;
    }
    try {
      const result = await protocol.setParameter(`RC${channel}_TRIM`, value);
      outcomes.push(
        result.success
          ? { channel, value, ok: true }
          : { channel, value, ok: false, reason: result.message },
      );
    } catch (err) {
      outcomes.push({ channel, value, ok: false, reason: formatErrorMessage(err) });
    }
  }
  return { kind: "done", outcomes };
}
