/**
 * Telemetry recording system.
 *
 * Captures all telemetry data with timestamps to IndexedDB for
 * later replay, export, and analysis. Start/stop recording from
 * the UI header. Recordings persist across sessions.
 *
 * @module telemetry-recorder
 * @license GPL-3.0-only
 */

import { get as idbGet, set as idbSet, del as idbDel, keys as idbKeys } from "idb-keyval";

// ── Types ────────────────────────────────────────────────────

export interface TelemetryFrame {
  /** Milliseconds since recording start. */
  offsetMs: number;
  /** Channel name (attitude, position, battery, etc.). */
  channel: string;
  /** The telemetry data object. */
  data: unknown;
}

export interface TelemetryRecording {
  id: string;
  /** Human-readable name. */
  name: string;
  /** Recording start timestamp (ms since epoch). */
  startTime: number;
  /** Recording end timestamp (ms since epoch). */
  endTime: number;
  /** Duration in ms. */
  durationMs: number;
  /** Total frame count. */
  frameCount: number;
  /** Channels captured. */
  channels: string[];
  /** Drone ID, if known. */
  droneId?: string;
  /** Drone name, if known. */
  droneName?: string;
}

// ── IDB Keys ─────────────────────────────────────────────────

const IDB_RECORDINGS_PREFIX = "altcmd:recording:";
const IDB_RECORDINGS_INDEX = "altcmd:recordings-index";

// ── Recorder ─────────────────────────────────────────────────

type RecordingState = "idle" | "recording" | "error";

interface RecorderSlot {
  state: RecordingState;
  startTime: number;
  frames: TelemetryFrame[];
  channels: Set<string>;
  recordingId: string;
  droneId?: string;
  droneName?: string;
  /** Last write timestamp per channel for rate limiting (ms since epoch). */
  lastWriteAt: Map<string, number>;
}

/**
 * Per-channel max sample rate in Hz. Frames received above this rate are
 * silently dropped to keep recordings within the 500k frame cap and IndexedDB
 * payloads under control. Phase 1 — see DEC plan.
 *
 * Channels not listed here use {@link DEFAULT_RATE_HZ}. Channels listed in
 * {@link CAP_BYPASS_CHANNELS} are exempt entirely.
 */
const CHANNEL_RATE_LIMIT_HZ: Record<string, number> = {
  attitude: 50,
  position: 10,
  globalPosition: 10,
  localPosition: 10,
  gps: 5,
  vfr: 10,
  vibration: 20,
  servoOutput: 20,
  rc: 10,
  radio: 5,
  battery: 5,
  sysStatus: 5,
  ekf: 5,
  wind: 2,
  terrain: 2,
  gimbal: 10,
  obstacle: 5,
  scaledImu: 50,
  homePosition: 1,
  powerStatus: 1,
  distanceSensor: 10,
  fenceStatus: 2,
  estimatorStatus: 5,
  cameraTrigger: 20,
  navController: 5,
  debug: 20,
};

const DEFAULT_RATE_HZ = 20;

/** Channels that bypass rate limiting (e.g. high-rate IMU in Phase 29). */
const CAP_BYPASS_CHANNELS = new Set<string>(["imu_highrate"]);

/** Sentinel slot key for the legacy single-drone API. */
const DEFAULT_SLOT = "__default__";

/** Max frames per recording. ~8 min at full rate before rate limiting. */
const MAX_FRAMES = 500_000;

const _slots = new Map<string, RecorderSlot>();

function newSlot(droneId?: string, droneName?: string): RecorderSlot {
  return {
    state: "recording",
    startTime: Date.now(),
    frames: [],
    channels: new Set(),
    recordingId: `rec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    droneId,
    droneName,
    lastWriteAt: new Map(),
  };
}

function getSlot(key: string): RecorderSlot | undefined {
  return _slots.get(key);
}

// ── Per-drone API (Phase 1) ──────────────────────────────────

/**
 * Start a recording for a specific drone slot. Independent from any other
 * drone's slot and from the legacy default slot. Returns the recording id.
 *
 * @throws if a recording is already in progress for this drone.
 */
export function startRecordingFor(droneId: string, droneName?: string): string {
  if (_slots.get(droneId)?.state === "recording") {
    throw new Error(`Already recording for drone ${droneId}`);
  }
  const slot = newSlot(droneId, droneName);
  _slots.set(droneId, slot);
  return slot.recordingId;
}

/**
 * Append a telemetry frame to the recording for {@link droneId}.
 * Noop if no recording is active for that drone. Rate-limited per channel
 * (see {@link CHANNEL_RATE_LIMIT_HZ}).
 */
export function recordFrameFor(droneId: string, channel: string, data: unknown): void {
  const slot = _slots.get(droneId);
  if (!slot || slot.state !== "recording") return;
  if (slot.frames.length >= MAX_FRAMES) return;

  if (!CAP_BYPASS_CHANNELS.has(channel)) {
    const rateHz = CHANNEL_RATE_LIMIT_HZ[channel] ?? DEFAULT_RATE_HZ;
    const minIntervalMs = 1000 / rateHz;
    const now = Date.now();
    const last = slot.lastWriteAt.get(channel) ?? 0;
    if (now - last < minIntervalMs) return;
    slot.lastWriteAt.set(channel, now);
  }

  slot.channels.add(channel);
  slot.frames.push({
    offsetMs: Date.now() - slot.startTime,
    channel,
    data,
  });
}

/**
 * Stop the recording for {@link droneId} and persist it. Returns metadata or
 * null if no active recording.
 */
export async function stopRecordingFor(droneId: string): Promise<TelemetryRecording | null> {
  const slot = _slots.get(droneId);
  if (!slot || slot.state !== "recording") return null;
  return await finalizeSlot(droneId, slot);
}

/** True if a recording is active for the given drone. */
export function isRecordingFor(droneId: string): boolean {
  return _slots.get(droneId)?.state === "recording";
}

/** Get recording state for the given drone. */
export function getRecordingStateFor(droneId: string): {
  state: RecordingState;
  durationMs: number;
  frameCount: number;
} {
  const slot = _slots.get(droneId);
  if (!slot) return { state: "idle", durationMs: 0, frameCount: 0 };
  return {
    state: slot.state,
    durationMs: slot.state === "recording" ? Date.now() - slot.startTime : 0,
    frameCount: slot.frames.length,
  };
}

// ── Legacy single-slot API (kept for RecordingControls header button) ────

/**
 * Start a new telemetry recording on the default slot.
 *
 * @deprecated Prefer {@link startRecordingFor} for multi-drone scenarios.
 * Retained so the existing header start/stop button keeps working.
 */
export function startRecording(droneId?: string, droneName?: string): string {
  if (_slots.get(DEFAULT_SLOT)?.state === "recording") {
    throw new Error("Already recording — stop current recording first");
  }
  const slot = newSlot(droneId, droneName);
  _slots.set(DEFAULT_SLOT, slot);
  return slot.recordingId;
}

/**
 * Append a frame to the default slot.
 *
 * @deprecated Prefer {@link recordFrameFor}.
 */
export function recordFrame(channel: string, data: unknown): void {
  // Delegate via a synthetic per-drone-style call against the default slot.
  const slot = _slots.get(DEFAULT_SLOT);
  if (!slot || slot.state !== "recording") return;
  if (slot.frames.length >= MAX_FRAMES) return;

  if (!CAP_BYPASS_CHANNELS.has(channel)) {
    const rateHz = CHANNEL_RATE_LIMIT_HZ[channel] ?? DEFAULT_RATE_HZ;
    const minIntervalMs = 1000 / rateHz;
    const now = Date.now();
    const last = slot.lastWriteAt.get(channel) ?? 0;
    if (now - last < minIntervalMs) return;
    slot.lastWriteAt.set(channel, now);
  }

  slot.channels.add(channel);
  slot.frames.push({
    offsetMs: Date.now() - slot.startTime,
    channel,
    data,
  });
}

/**
 * Stop the default-slot recording and persist it.
 *
 * @deprecated Prefer {@link stopRecordingFor}.
 */
export async function stopRecording(): Promise<TelemetryRecording | null> {
  const slot = _slots.get(DEFAULT_SLOT);
  if (!slot || slot.state !== "recording") return null;
  return await finalizeSlot(DEFAULT_SLOT, slot);
}

/**
 * Get default-slot recording state.
 *
 * @deprecated Prefer {@link getRecordingStateFor}.
 */
export function getRecordingState(): {
  state: RecordingState;
  durationMs: number;
  frameCount: number;
} {
  const slot = _slots.get(DEFAULT_SLOT);
  if (!slot) return { state: "idle", durationMs: 0, frameCount: 0 };
  return {
    state: slot.state,
    durationMs: slot.state === "recording" ? Date.now() - slot.startTime : 0,
    frameCount: slot.frames.length,
  };
}

// ── Internal: persist a slot ─────────────────────────────────

async function finalizeSlot(slotKey: string, slot: RecorderSlot): Promise<TelemetryRecording> {
  const endTime = Date.now();
  const recording: TelemetryRecording = {
    id: slot.recordingId,
    name: `Recording ${new Date(slot.startTime).toLocaleString()}`,
    startTime: slot.startTime,
    endTime,
    durationMs: endTime - slot.startTime,
    frameCount: slot.frames.length,
    channels: Array.from(slot.channels),
    droneId: slot.droneId,
    droneName: slot.droneName,
  };

  await idbSet(`${IDB_RECORDINGS_PREFIX}${slot.recordingId}`, slot.frames);

  const index: TelemetryRecording[] = (await idbGet(IDB_RECORDINGS_INDEX)) ?? [];
  index.push(recording);
  while (index.length > 20) {
    const oldest = index.shift()!;
    await idbDel(`${IDB_RECORDINGS_PREFIX}${oldest.id}`);
  }
  await idbSet(IDB_RECORDINGS_INDEX, index);

  _slots.delete(slotKey);
  return recording;
}

/**
 * Insert a fully-formed recording into IDB without going through the live
 * arm/disarm slot machinery. Used by importers (Phase 11 dataflash + Phase 30
 * ULog) that already have all frames in memory and just need them stored
 * + indexed so the existing Charts/Replay/Analysis pipeline can read them.
 *
 * Caller is responsible for choosing a unique `id` (e.g. `dataflash-<uuid>`).
 * The LRU cap on the recordings index does not apply to imported recordings —
 * they're typically larger and the user explicitly asked to import them.
 */
export async function setRecordingFromFrames(
  id: string,
  name: string,
  frames: TelemetryFrame[],
  options: {
    droneId?: string;
    droneName?: string;
    startTimeMs?: number;
  } = {},
): Promise<TelemetryRecording> {
  const startTime = options.startTimeMs ?? Date.now();
  const lastOffsetMs = frames.length > 0 ? frames[frames.length - 1].offsetMs : 0;
  const endTime = startTime + lastOffsetMs;

  const channels = new Set<string>();
  for (const frame of frames) channels.add(frame.channel);

  const recording: TelemetryRecording = {
    id,
    name,
    startTime,
    endTime,
    durationMs: endTime - startTime,
    frameCount: frames.length,
    channels: Array.from(channels),
    droneId: options.droneId,
    droneName: options.droneName,
  };

  await idbSet(`${IDB_RECORDINGS_PREFIX}${id}`, frames);

  const index: TelemetryRecording[] = (await idbGet(IDB_RECORDINGS_INDEX)) ?? [];
  // Replace any existing entry with the same id (idempotent re-import).
  const filtered = index.filter((r) => r.id !== id);
  filtered.push(recording);
  await idbSet(IDB_RECORDINGS_INDEX, filtered);

  return recording;
}

/**
 * List all saved recordings.
 */
export async function listRecordings(): Promise<TelemetryRecording[]> {
  return (await idbGet(IDB_RECORDINGS_INDEX)) ?? [];
}

/**
 * Load frames for a recording.
 */
export async function loadRecordingFrames(recordingId: string): Promise<TelemetryFrame[]> {
  return (await idbGet(`${IDB_RECORDINGS_PREFIX}${recordingId}`)) ?? [];
}

/**
 * Delete a recording.
 */
export async function deleteRecording(recordingId: string): Promise<void> {
  await idbDel(`${IDB_RECORDINGS_PREFIX}${recordingId}`);
  const index: TelemetryRecording[] = (await idbGet(IDB_RECORDINGS_INDEX)) ?? [];
  const filtered = index.filter((r) => r.id !== recordingId);
  await idbSet(IDB_RECORDINGS_INDEX, filtered);
}

/**
 * Export a recording as CSV.
 */
export async function exportRecordingCSV(recordingId: string): Promise<string> {
  const frames = await loadRecordingFrames(recordingId);
  if (frames.length === 0) return "";

  const rows = ["offsetMs,channel,data"];
  for (const frame of frames) {
    rows.push(`${frame.offsetMs},${frame.channel},"${JSON.stringify(frame.data).replace(/"/g, '""')}"`);
  }
  return rows.join("\n");
}

/**
 * Export a recording as .tlog binary format.
 *
 * .tlog format: for each frame, write an 8-byte little-endian timestamp
 * (microseconds since epoch) followed by the frame data encoded as JSON
 * with a 4-byte little-endian length prefix.
 *
 * Since we don't store raw MAVLink bytes, we use a structured binary
 * format: [8-byte timestamp (uint64 LE, microseconds)] [4-byte length (uint32 LE)]
 * [UTF-8 JSON payload of {channel, data}].
 *
 * This can be converted to standard .tlog with external tooling if needed.
 */
export async function exportTlog(recordingId: string): Promise<Blob | null> {
  const recordings = await listRecordings();
  const recording = recordings.find((r) => r.id === recordingId);
  if (!recording) return null;

  const frames = await loadRecordingFrames(recordingId);
  if (frames.length === 0) return null;

  const encoder = new TextEncoder();
  const chunks: ArrayBuffer[] = [];

  for (const frame of frames) {
    // Absolute timestamp in microseconds (split into low/high 32-bit words for LE uint64)
    const timestampMs = recording.startTime + frame.offsetMs;
    const timestampUs = timestampMs * 1000;
    const low = timestampUs % 0x100000000;
    const high = Math.floor(timestampUs / 0x100000000);

    // Encode the frame payload as JSON
    const payload = encoder.encode(JSON.stringify({ channel: frame.channel, data: frame.data }));

    // 8-byte timestamp (uint64 LE) + 4-byte payload length (uint32 LE) + payload
    const header = new ArrayBuffer(12);
    const view = new DataView(header);
    view.setUint32(0, low, true);
    view.setUint32(4, high, true);
    view.setUint32(8, payload.byteLength, true);

    chunks.push(header);
    chunks.push(payload.buffer as ArrayBuffer);
  }

  return new Blob(chunks, { type: "application/octet-stream" });
}
