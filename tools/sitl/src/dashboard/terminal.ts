// terminal.ts — ANSI terminal dashboard for SITL status display
// SPDX-License-Identifier: GPL-3.0-only

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DashboardConfig {
  /** URL (with token) the GCS dials for drone #1. */
  wsUrl: string;
  vehicle: string;
  speedup: number;
  presetName?: string;
}

export interface DroneState {
  mode: string;
  armed: boolean;
  lat: number;
  lon: number;
}

export interface HeartbeatResult {
  sysId: number;
  mode: string;
  armed: boolean;
}

export interface PositionResult {
  sysId: number;
  lat: number;
  lon: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VERSION = "v0.1.0";
const REFRESH_MS = 500;
const MAX_LOG_LINES = 10;
const BOX_WIDTH = 64;

/** ANSI escape helpers */
const ESC = "\x1B";
const CLEAR = `${ESC}[2J${ESC}[H`;
const BOLD = `${ESC}[1m`;
const GREEN = `${ESC}[32m`;
const YELLOW = `${ESC}[33m`;
const CYAN = `${ESC}[36m`;
const DIM = `${ESC}[2m`;
const RESET = `${ESC}[0m`;
const HIDE_CURSOR = `${ESC}[?25l`;
const SHOW_CURSOR = `${ESC}[?25h`;

/** ArduCopter custom_mode -> human-readable name */
const COPTER_MODES: Record<number, string> = {
  0: "STABILIZE",
  1: "ACRO",
  2: "ALT_HOLD",
  3: "AUTO",
  4: "GUIDED",
  5: "LOITER",
  6: "RTL",
  7: "CIRCLE",
  9: "LAND",
  11: "DRIFT",
  13: "SPORT",
  14: "FLIP",
  15: "AUTOTUNE",
  16: "POSHOLD",
  17: "BRAKE",
  18: "THROW",
  19: "AVOID_ADSB",
  20: "GUIDED_NOGPS",
  21: "SMART_RTL",
};

// ---------------------------------------------------------------------------
// MAVLink v2 peek helpers
// ---------------------------------------------------------------------------

const MAVLINK_V2_STX = 0xfd;
const MAVLINK_V2_HEADER_LEN = 10; // STX(1)+len(1)+incompat(1)+compat(1)+seq(1)+sysid(1)+compid(1)+msgid(3)

/**
 * Scan a buffer for a MAVLink v2 HEARTBEAT (msgId 0).
 * Returns parsed heartbeat data or null if not found.
 */
export function parseHeartbeat(data: Buffer): HeartbeatResult | null {
  for (let i = 0; i <= data.length - MAVLINK_V2_HEADER_LEN; i++) {
    if (data[i] !== MAVLINK_V2_STX) continue;

    const payloadLen = data[i + 1];
    // msgId is 3 bytes LE at offset 7, 8, 9
    const msgId = data[i + 7] | (data[i + 8] << 8) | (data[i + 9] << 16);
    if (msgId !== 0) continue;

    const payloadStart = i + MAVLINK_V2_HEADER_LEN;
    if (payloadStart + payloadLen > data.length) continue;

    // HEARTBEAT payload: custom_mode(4) type(1) autopilot(1) base_mode(1) ...
    const customMode = data.readUInt32LE(payloadStart);
    const baseMode = data[payloadStart + 6];
    const sysId = data[i + 5];
    const armed = (baseMode & 0x80) !== 0;
    const mode = COPTER_MODES[customMode] ?? `MODE_${customMode}`;

    return { sysId, mode, armed };
  }
  return null;
}

/**
 * Scan a buffer for a MAVLink v2 GLOBAL_POSITION_INT (msgId 33).
 * Returns lat/lon in degrees or null if not found.
 */
export function parseGlobalPositionInt(data: Buffer): PositionResult | null {
  for (let i = 0; i <= data.length - MAVLINK_V2_HEADER_LEN; i++) {
    if (data[i] !== MAVLINK_V2_STX) continue;

    const payloadLen = data[i + 1];
    const msgId = data[i + 7] | (data[i + 8] << 8) | (data[i + 9] << 16);
    if (msgId !== 33) continue;

    const payloadStart = i + MAVLINK_V2_HEADER_LEN;
    if (payloadStart + payloadLen > data.length) continue;

    // GLOBAL_POSITION_INT payload: time_boot_ms(4) lat(4) lon(4) ...
    // lat at offset 4, lon at offset 8 — both int32 LE in degE7
    const sysId = data[i + 5];
    const latE7 = data.readInt32LE(payloadStart + 4);
    const lonE7 = data.readInt32LE(payloadStart + 8);

    return { sysId, lat: latE7 / 1e7, lon: lonE7 / 1e7 };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Box-drawing helpers
// ---------------------------------------------------------------------------

function pad(text: string, width: number): string {
  // Strip ANSI codes to measure visible length
  const visible = text.replace(/\x1B\[[0-9;]*m/g, "");
  const padding = Math.max(0, width - visible.length);
  return text + " ".repeat(padding);
}

function topBorder(): string {
  return `\u2554${"".padStart(BOX_WIDTH, "\u2550")}\u2557`;
}

function midBorder(): string {
  return `\u2560${"".padStart(BOX_WIDTH, "\u2550")}\u2563`;
}

function botBorder(): string {
  return `\u255A${"".padStart(BOX_WIDTH, "\u2550")}\u255D`;
}

function row(content: string): string {
  return `\u2551 ${pad(content, BOX_WIDTH - 2)} \u2551`;
}

function timestamp(): string {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, "0");
  const m = String(now.getMinutes()).padStart(2, "0");
  const s = String(now.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

// ---------------------------------------------------------------------------
// Dashboard class
// ---------------------------------------------------------------------------

export class Dashboard {
  private config: DashboardConfig;
  private drones: Map<number, DroneState> = new Map();
  private logs: string[] = [];
  private clientCount = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(config: DashboardConfig) {
    this.config = config;
  }

  /** Update (or create) state for a given sysId. */
  updateDroneState(sysId: number, state: Partial<DroneState>): void {
    const prev = this.drones.get(sysId) ?? {
      mode: "UNKNOWN",
      armed: false,
      lat: 0,
      lon: 0,
    };
    this.drones.set(sysId, { ...prev, ...state });
  }

  /** Append a timestamped log entry. */
  addLog(message: string): void {
    this.logs.push(`${DIM}[${timestamp()}]${RESET} ${message}`);
    if (this.logs.length > MAX_LOG_LINES) {
      this.logs.shift();
    }
  }

  /** Update the connected WebSocket client count. */
  updateClientCount(count: number): void {
    this.clientCount = count;
  }

  /** Start the 2 Hz refresh loop. */
  start(): void {
    if (this.running) return;
    this.running = true;
    process.stdout.write(HIDE_CURSOR);
    this.render();
    this.timer = setInterval(() => this.render(), REFRESH_MS);
  }

  /** Stop the refresh loop and restore terminal state. */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    process.stdout.write(SHOW_CURSOR);
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  private render(): void {
    const lines: string[] = [];

    // Header
    lines.push(topBorder());
    lines.push(
      row(`${BOLD}${CYAN}ALTNAUTICA SITL${RESET}  ${VERSION}    Clients: ${this.clientCount}`),
    );
    lines.push(row(`GCS: ${this.config.wsUrl}`));
    const vehicleStr = this.config.presetName
      ? `${this.config.vehicle}  |  ${BOLD}${this.config.presetName}${RESET}  |  Speed: ${this.config.speedup.toFixed(1)}x`
      : `${this.config.vehicle}  |  Physics: SITL  |  Speed: ${this.config.speedup.toFixed(1)}x`;
    lines.push(row(vehicleStr));

    // Drone rows
    lines.push(midBorder());
    if (this.drones.size === 0) {
      lines.push(row(`${DIM}No drones connected${RESET}`));
    } else {
      const sorted = [...this.drones.entries()].sort((a, b) => a[0] - b[0]);
      for (const [sysId, state] of sorted) {
        const armedStr = state.armed
          ? `${GREEN}${BOLD}Armed${RESET}`
          : `${YELLOW}Disarmed${RESET}`;
        const latDir = state.lat >= 0 ? "N" : "S";
        const lonDir = state.lon >= 0 ? "E" : "W";
        const latStr = `${Math.abs(state.lat).toFixed(4)}\u00B0${latDir}`;
        const lonStr = `${Math.abs(state.lon).toFixed(4)}\u00B0${lonDir}`;
        lines.push(
          row(
            `Drone ${sysId} (sysid=${sysId})  ${BOLD}${state.mode}${RESET} ${armedStr}  ${latStr} ${lonStr}`,
          ),
        );
      }
    }

    // Log area
    lines.push(midBorder());
    if (this.logs.length === 0) {
      lines.push(row(`${DIM}No log entries${RESET}`));
    } else {
      for (const entry of this.logs) {
        lines.push(row(entry));
      }
    }
    lines.push(botBorder());

    process.stdout.write(CLEAR + lines.join("\n") + "\n");
  }
}
