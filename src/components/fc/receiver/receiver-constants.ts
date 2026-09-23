import { RC_PROTOCOLS } from "@/lib/rc-options";

export const RC_CHANNEL_COUNT = 16;

export const CHANNEL_OPTIONS = Array.from({ length: RC_CHANNEL_COUNT }, (_, i) => ({
  value: String(i + 1),
  label: `Channel ${i + 1}`,
}));

/**
 * `RC_PROTOCOLS` bit index → label, derived from the repo's canonical table in
 * `@/lib/rc-options` rather than hand-maintained here.
 *
 * This used to be a `Select` whose option VALUES were one bit position short of
 * the parameter's real encoding — it offered `256 — CRSF` when CRSF is bit 9
 * (512), so picking "CRSF" wrote SRXL2 and the flight controller stopped
 * decoding the receiver entirely on the next reboot. It also rendered the
 * common value `1` (ArduPilot's "All") as "PPM", and a Select can only ever
 * express ONE bit of a parameter the label itself calls a bitmask.
 */
export const RC_PROTOCOLS_BITMASK: Map<number, string> = new Map(
  RC_PROTOCOLS.map(({ bit, label }) => [bit, label]),
);

/** ArduPilot RSSI_TYPE values (AP_RSSI RssiType). */
export const RSSI_TYPE_OPTIONS = [
  { value: "0", label: "0 — Disabled" },
  { value: "1", label: "1 — Analog Pin" },
  { value: "2", label: "2 — RC Channel PWM" },
  { value: "3", label: "3 — Receiver Protocol (CRSF/ELRS, SBUS, ...)" },
  { value: "4", label: "4 — PWM Input Pin" },
  { value: "5", label: "5 — Telemetry Radio RSSI" },
];

/**
 * Per-channel reversal. ArduPilot stores RCn_REVERSED as 0 normal / 1
 * reversed; PX4 stores RCn_REV as 1 normal / -1 reversed.
 */
export interface ChannelReversal {
  param: (ch: number) => string;
  isReversed: (value: number | undefined) => boolean;
  encode: (reversed: boolean) => number;
}

export const RC_REVERSAL: Record<"ardupilot" | "px4", ChannelReversal> = {
  ardupilot: {
    param: (ch) => `RC${ch}_REVERSED`,
    isReversed: (v) => (v ?? 0) !== 0,
    encode: (r) => (r ? 1 : 0),
  },
  px4: {
    param: (ch) => `RC${ch}_REV`,
    isReversed: (v) => v === -1,
    encode: (r) => (r ? -1 : 1),
  },
};

/**
 * Params the receiver panel reads. PX4 has no RC_PROTOCOLS, RSSI_TYPE or
 * per-channel deadzone, and names reversal RCn_REV.
 */
export function receiverParams(isPx4: boolean): string[] {
  const reversal = RC_REVERSAL[isPx4 ? "px4" : "ardupilot"];
  return [
    "RCMAP_ROLL", "RCMAP_PITCH", "RCMAP_THROTTLE", "RCMAP_YAW",
    ...(isPx4 ? [] : ["RC_PROTOCOLS", "RSSI_TYPE"]),
    ...Array.from({ length: RC_CHANNEL_COUNT }, (_, i) => {
      const n = i + 1;
      const perChannel = [`RC${n}_MIN`, `RC${n}_MAX`, `RC${n}_TRIM`, reversal.param(n)];
      return isPx4 ? perChannel : [...perChannel, `RC${n}_DZ`];
    }).flat(),
  ];
}
