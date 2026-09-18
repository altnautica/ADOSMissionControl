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

export const RSSI_TYPE_OPTIONS = [
  { value: "0", label: "0 — Disabled" },
  { value: "1", label: "1 — Analog Pin" },
  { value: "2", label: "2 — RC Channel PWM" },
  { value: "3", label: "3 — Receiver Protocol" },
  { value: "4", label: "4 — Telemetry Radio RSSI" },
  { value: "5", label: "5 — CRSF/ELRS" },
];

export const RECEIVER_PARAMS: string[] = [
  "RCMAP_ROLL", "RCMAP_PITCH", "RCMAP_THROTTLE", "RCMAP_YAW",
  "RC_PROTOCOLS", "RSSI_TYPE",
  ...Array.from({ length: RC_CHANNEL_COUNT }, (_, i) => {
    const n = i + 1;
    return [`RC${n}_MIN`, `RC${n}_MAX`, `RC${n}_TRIM`, `RC${n}_REVERSED`, `RC${n}_DZ`];
  }).flat(),
];
