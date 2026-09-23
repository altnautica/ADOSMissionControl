/**
 * Stream-rate parameter naming. ArduPilot 4.7 and later index the per-channel
 * stream-rate groups as MAVn_* (channel 1 = MAV1_*); 4.6 and older name them
 * SRn_* with a zero-based index (channel 1 = SR0_*). A vehicle reports exactly
 * one family, so the panel reads both and edits the one that answered.
 *
 * @license GPL-3.0-only
 */

export type StreamFamily = "MAV" | "SR";

/** The MAVLink stream groups, each an independent rate (Hz). */
export const STREAM_GROUPS: readonly { suffix: string; label: string }[] = [
  { suffix: "RAW_SENS", label: "Raw Sensors (IMU, pressure)" },
  { suffix: "EXT_STAT", label: "Extended Status (sys, battery, GPS)" },
  { suffix: "RC_CHAN", label: "RC Channels & Servo Output" },
  { suffix: "RAW_CTRL", label: "Raw Controller" },
  { suffix: "POSITION", label: "Position" },
  { suffix: "EXTRA1", label: "Extra 1 (Attitude)" },
  { suffix: "EXTRA2", label: "Extra 2 (VFR HUD)" },
  { suffix: "EXTRA3", label: "Extra 3 (AHRS, wind, status)" },
  { suffix: "PARAMS", label: "Parameters" },
  { suffix: "ADSB", label: "ADS-B" },
];

/** Param name of one group on a 1-based MAVLink channel. */
export function streamRateParam(family: StreamFamily, channel: number, suffix: string): string {
  return family === "MAV" ? `MAV${channel}_${suffix}` : `SR${channel - 1}_${suffix}`;
}

/** Both families' names for a channel, for loading before the family is known. */
export function streamRateLoadNames(channel: number): string[] {
  return (["MAV", "SR"] as const).flatMap((family) =>
    STREAM_GROUPS.map((g) => streamRateParam(family, channel, g.suffix)),
  );
}

/** The family the vehicle reported for a channel, or null when it reported
 *  neither (nothing read yet, or the channel has no stream-rate params). */
export function detectStreamFamily(
  params: ReadonlyMap<string, number>,
  channel: number,
): StreamFamily | null {
  for (const family of ["MAV", "SR"] as const) {
    if (STREAM_GROUPS.some((g) => params.has(streamRateParam(family, channel, g.suffix)))) {
      return family;
    }
  }
  return null;
}
