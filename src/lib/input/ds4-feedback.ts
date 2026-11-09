/**
 * @module input/ds4-feedback
 * @description Controller feedback from the shared cockpit spec `ds4.json`:
 *
 *   - rumble patterns (mode change, warning, critical, the hold ramp and the
 *     countdown) through the Gamepad `vibrationActuator`;
 *   - the lightbar colour for the flight state (disarmed green, pilot blue,
 *     skill cyan, mission magenta, RTH amber blink, low battery red pulse,
 *     failsafe red blink), written over WebHID to a DualShock 4. WebHID needs
 *     a secure origin (https, or the desktop app) and a one-time device grant
 *     from a user gesture (Settings › Controls › Lightbar).
 *
 * @license GPL-3.0-only
 */

import ds4 from "@/lib/cockpit/spec/ds4.json";
import type { PilotState } from "@/lib/hud/cockpit-frames";

type RumbleSpec = { pulses_ms: number[]; gap_ms: number; strong: number; weak: number };
const RUMBLE = ds4.rumble as unknown as Record<string, RumbleSpec>;

type Actuator = {
  playEffect?: (type: string, params: Record<string, number>) => Promise<unknown>;
};

function actuators(): Actuator[] {
  if (typeof navigator === "undefined" || !navigator.getGamepads) return [];
  return [...navigator.getGamepads()]
    .filter((p): p is Gamepad => p !== null)
    .map((p) => (p as unknown as { vibrationActuator?: Actuator }).vibrationActuator)
    .filter((a): a is Actuator => a !== undefined && typeof a.playEffect === "function");
}

/** Whether the connected pad can rumble from this browser. */
export function canRumble(): boolean {
  return actuators().length > 0;
}

function pulse(durationMs: number, strong: number, weak: number): void {
  for (const a of actuators()) {
    void a.playEffect?.("dual-rumble", { duration: durationMs, strongMagnitude: strong, weakMagnitude: weak, startDelay: 0 })?.catch(() => {});
  }
}

/** Play a named pattern: `mode_change`, `warning` or `critical`. */
export function rumble(pattern: string): void {
  const p = RUMBLE[pattern];
  if (!p || !Array.isArray(p.pulses_ms)) return;
  let at = 0;
  for (const ms of p.pulses_ms) {
    setTimeout(() => pulse(ms, p.strong, p.weak), at);
    at += ms + p.gap_ms;
  }
}

/** One tick of the hold ramp (`progress` 0..1) or the countdown pulse. */
export function rumbleHoldTick(pattern: string | null, progress: number): void {
  if (pattern === "ramp") {
    const r = ds4.rumble.ramp;
    const m = r.from + (r.to - r.from) * progress;
    pulse(r.tick_ms, m, m);
  } else if (pattern === "countdown") {
    pulse(ds4.rumble.countdown.pulse_ms, 0.6, 0.6);
  }
}

export type LightbarState = keyof typeof ds4.lightbar.states;

/** The lightbar state for the pilot, by the spec's priority. */
export function lightbarState(pilot: PilotState | null, opts: { lowBattery: boolean; linkLost: boolean }): LightbarState {
  const owner = pilot?.owner ?? null;
  const rth = !!pilot?.fcModeName && /RTL|QRTL/i.test(pilot.fcModeName);
  const failsafe = opts.linkLost || pilot?.holdReason === "input-stale" || pilot?.linkLossInS != null;
  const cand: Record<LightbarState, boolean> = {
    failsafe,
    low_battery: opts.lowBattery || pilot?.rthCountdownS != null,
    rth,
    mission: owner === "mission_fc",
    skill: owner === "skill",
    pilot: owner === "pilot" || owner === "goto" || owner === "swarm",
    armed_idle: pilot?.armed === true,
    disarmed: true,
  };
  return (ds4.lightbar.priority as LightbarState[]).find((s) => cand[s]) ?? "disarmed";
}

/** The colour to show at `nowMs` for a state (blink and pulse applied), as RGB 0..255. */
export function lightbarColour(state: LightbarState, nowMs: number): [number, number, number] {
  const s = ds4.lightbar.states[state] as { color: string; pattern: string; hz: number | null };
  const hex = s.color.replace("#", "");
  const rgb: [number, number, number] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
  if (!s.hz) return rgb;
  const phase = (nowMs / 1000) * s.hz;
  const k = s.pattern === "blink" ? (phase % 1 < 0.5 ? 1 : 0) : 0.5 + 0.5 * Math.sin(phase * 2 * Math.PI);
  return rgb.map((c) => Math.round(c * k)) as [number, number, number];
}

// ── WebHID lightbar ───────────────────────────────────────────────────

type HidDevice = {
  opened: boolean;
  open: () => Promise<void>;
  sendReport: (id: number, data: Uint8Array) => Promise<void>;
  collections?: { outputReports?: { reportId: number }[] }[];
};
type HidApi = {
  getDevices: () => Promise<HidDevice[]>;
  requestDevice: (o: { filters: { vendorId: number }[] }) => Promise<HidDevice[]>;
};

const SONY_VENDOR = 0x054c;
let device: HidDevice | null = null;

function hid(): HidApi | null {
  if (typeof navigator === "undefined") return null;
  return (navigator as Navigator & { hid?: HidApi }).hid ?? null;
}

/** Whether this platform can set the lightbar (WebHID on a secure origin). */
export function lightbarSupported(): boolean {
  return hid() !== null && (typeof window === "undefined" || window.isSecureContext);
}

/** Ask for the controller (from a user gesture). Returns whether one is granted. */
export async function requestLightbarDevice(): Promise<boolean> {
  const api = hid();
  if (!api) return false;
  const granted = await api.requestDevice({ filters: [{ vendorId: SONY_VENDOR }] }).catch(() => []);
  device = granted[0] ?? null;
  return device !== null;
}

async function grantedDevice(): Promise<HidDevice | null> {
  if (device) return device;
  const api = hid();
  if (!api) return null;
  const list = await api.getDevices().catch(() => []);
  device = list[0] ?? null;
  return device;
}

/** CRC-32 (IEEE) of the Bluetooth output report, seeded with 0xA2. */
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** Write the lightbar colour. Resolves false when no controller is granted. */
export async function setLightbar(rgb: [number, number, number]): Promise<boolean> {
  const d = await grantedDevice();
  if (!d) return false;
  if (!d.opened) await d.open().catch(() => {});
  const bluetooth = d.collections?.some((c) => c.outputReports?.some((r) => r.reportId === 0x11)) ?? false;
  try {
    if (bluetooth) {
      // Report 0x11 is 78 bytes with its id: 73 data bytes then a CRC-32
      // over 0xA2 (the output header), the id and the data.
      const buf = new Uint8Array(79);
      buf[0] = 0xa2;
      buf[1] = 0x11;
      buf[2] = 0xc0;
      buf[3] = 0x20;
      buf[4] = 0x07;
      buf[9] = rgb[0];
      buf[10] = rgb[1];
      buf[11] = rgb[2];
      const crc = crc32(buf.subarray(0, 75));
      buf[75] = crc & 0xff;
      buf[76] = (crc >>> 8) & 0xff;
      buf[77] = (crc >>> 16) & 0xff;
      buf[78] = (crc >>> 24) & 0xff;
      await d.sendReport(0x11, buf.subarray(2, 79));
    } else {
      const buf = new Uint8Array(31);
      buf[0] = 0x07;
      buf[5] = rgb[0];
      buf[6] = rgb[1];
      buf[7] = rgb[2];
      await d.sendReport(0x05, buf);
    }
    return true;
  } catch {
    return false;
  }
}
