/**
 * Telemetry recording system.
 *
 * Captures telemetry frames per drone with timestamps to IndexedDB for
 * later replay, export, and analysis. Recordings persist across sessions.
 *
 * @module telemetry-recorder
 * @license GPL-3.0-only
 */

import { get as idbGet, set as idbSet, del as idbDel } from "idb-keyval";

// ── Types ────────────────────────────────────────────────────

export interface TelemetryFrame {
  /** Milliseconds since recording start. */
  offsetMs: number;
  /** Channel name (attitude, position, battery, etc.). */
  channel: string;
  /** The telemetry data object. */
  data: unknown;
}

/**
 * An operator- or plugin-placed annotation on a recording timeline. Marks a
 * moment of interest (an event, a manual flag) at a fixed offset from the
 * recording start so Charts/Replay can pin it later.
 */
export interface RecordingMarker {
  /** Milliseconds since recording start. */
  offsetMs: number;
  /** Short human-readable label. */
  label: string;
  /** Optional structured payload carried with the marker. */
  data?: Record<string, unknown>;
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
  /** Timeline markers, if any were placed during the recording. */
  markers?: RecordingMarker[];
  /**
   * True for a recording brought in from a log file. Imports are kept until
   * the operator deletes them; only live recordings are trimmed to the
   * newest {@link MAX_LIVE_RECORDINGS}.
   */
  imported?: boolean;
}

// ── IDB Keys ─────────────────────────────────────────────────

const IDB_RECORDINGS_PREFIX = "altcmd:recording:";
const IDB_RECORDINGS_INDEX = "altcmd:recordings-index";

// ── Recorder ─────────────────────────────────────────────────

/** A slot is recording while it is in {@link _slots}; finalizing removes it first. */
interface RecorderSlot {
  startTime: number;
  frames: TelemetryFrame[];
  channels: Set<string>;
  recordingId: string;
  droneId?: string;
  droneName?: string;
  /** Timeline markers placed during the recording. */
  markers: RecordingMarker[];
  /** Last write timestamp per channel for rate limiting (ms since epoch). */
  lastWriteAt: Map<string, number>;
}

/**
 * Per-channel max sample rate in Hz. Frames received above this rate are
 * silently dropped to keep recordings within the 500k frame cap and IndexedDB
 * payloads under control.
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

/** Channels that bypass rate limiting (e.g. high-rate IMU). */
const CAP_BYPASS_CHANNELS = new Set<string>(["imu_highrate"]);

/** Max frames per recording. ~8 min at full rate before rate limiting. */
const MAX_FRAMES = 500_000;

/** Live recordings kept in the index; the oldest beyond this are deleted. */
const MAX_LIVE_RECORDINGS = 20;

const _slots = new Map<string, RecorderSlot>();
/** Mirror slot keys fed by a drone's frame stream, keyed by drone id. */
const _mirrors = new Map<string, Set<string>>();

function newSlot(droneId?: string, droneName?: string): RecorderSlot {
  return {
    startTime: Date.now(),
    frames: [],
    channels: new Set(),
    recordingId: `rec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    droneId,
    droneName,
    markers: [],
    lastWriteAt: new Map(),
  };
}

// ── Per-drone API ────────────────────────────────────────────

/**
 * Start a recording for a specific drone slot. Independent from any other
 * drone's slot. Returns the recording id.
 *
 * @throws if a recording is already in progress for this drone.
 */
export function startRecordingFor(droneId: string, droneName?: string): string {
  if (_slots.has(droneId)) {
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
  if (slot) appendFrame(slot, channel, data);
  const mirrors = _mirrors.get(droneId);
  if (!mirrors) return;
  for (const key of mirrors) {
    const mirror = _slots.get(key);
    if (mirror) appendFrame(mirror, channel, data);
  }
}

function appendFrame(slot: RecorderSlot, channel: string, data: unknown): void {
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
 * Start a recording in its own slot (`slotKey`) that is fed from
 * {@link droneId}'s frame stream, independent of that drone's own slot. Used
 * for recordings a plugin starts: stopping it never touches the drone's
 * flight recording, and the flight recording never stops it. The recording
 * carries {@link droneId} as its drone. Stop it with `stopRecordingFor(slotKey)`.
 *
 * @throws if a recording is already in progress for this slot.
 */
export function startMirrorRecording(slotKey: string, droneId: string, droneName?: string): string {
  if (_slots.has(slotKey)) {
    throw new Error(`Already recording for ${slotKey}`);
  }
  const slot = newSlot(droneId, droneName);
  _slots.set(slotKey, slot);
  const mirrors = _mirrors.get(droneId) ?? new Set<string>();
  mirrors.add(slotKey);
  _mirrors.set(droneId, mirrors);
  return slot.recordingId;
}

/**
 * Place a timeline marker on the active recording for {@link droneId}.
 *
 * Appends a marker at the current offset (`Date.now() - slot.startTime`).
 * Returns true if a recording was active for that drone, false otherwise so
 * a caller can surface "not recording" without throwing.
 */
export function markRecording(
  droneId: string,
  label: string,
  data?: Record<string, unknown>,
): boolean {
  const slot = _slots.get(droneId);
  if (!slot) return false;
  slot.markers.push({
    offsetMs: Date.now() - slot.startTime,
    label,
    ...(data !== undefined ? { data } : {}),
  });
  return true;
}

/**
 * Stop the recording for {@link droneId} and persist it. Returns metadata or
 * null if no active recording.
 */
export async function stopRecordingFor(droneId: string): Promise<TelemetryRecording | null> {
  const slot = _slots.get(droneId);
  if (!slot) return null;
  return await finalizeSlot(droneId, slot);
}

/** True if a recording is active for the given drone. */
export function isRecordingFor(droneId: string): boolean {
  return _slots.has(droneId);
}

/** The recording currently capturing {@link droneId}'s frames, if any. */
export function activeRecordingFor(droneId: string): { recordingId: string; startTime: number } | undefined {
  const slot = _slots.get(droneId);
  return slot ? { recordingId: slot.recordingId, startTime: slot.startTime } : undefined;
}

/**
 * The frames recording {@link recordingId} captured between two wall-clock
 * times, with offsets rebased to `fromMs`. Reads the live slot while the
 * recording is still running on {@link droneId}, otherwise the stored frames.
 */
export async function recordingFramesBetween(
  droneId: string,
  recordingId: string,
  fromMs: number,
  toMs: number,
): Promise<TelemetryFrame[]> {
  const slot = _slots.get(droneId);
  let startTime: number;
  let frames: TelemetryFrame[];
  if (slot?.recordingId === recordingId) {
    startTime = slot.startTime;
    frames = slot.frames;
  } else {
    const stored = (await listRecordings()).find((r) => r.id === recordingId);
    if (!stored) return [];
    startTime = stored.startTime;
    frames = await loadRecordingFrames(recordingId);
  }
  const fromOffset = fromMs - startTime;
  const toOffset = toMs - startTime;
  const out: TelemetryFrame[] = [];
  for (const f of frames) {
    if (f.offsetMs < fromOffset || f.offsetMs > toOffset) continue;
    out.push({ offsetMs: f.offsetMs - fromOffset, channel: f.channel, data: f.data });
  }
  return out;
}

// ── Internal: the recordings index ───────────────────────────

/**
 * Every read-modify-write of the index runs on this chain, so two writers
 * (two drones disarming together, an import during a finalize) never read
 * the same index and overwrite each other's entry.
 */
let _indexChain: Promise<unknown> = Promise.resolve();

function mutateIndex(mutate: (index: TelemetryRecording[]) => Promise<TelemetryRecording[]>): Promise<void> {
  const run = _indexChain.then(async () => {
    const index: TelemetryRecording[] = (await idbGet(IDB_RECORDINGS_INDEX)) ?? [];
    await idbSet(IDB_RECORDINGS_INDEX, await mutate(index));
  });
  _indexChain = run.catch(() => undefined);
  return run;
}

/**
 * Store {@link recording}'s frames and add it to the index, replacing an
 * entry with the same id. Live recordings beyond the newest
 * {@link MAX_LIVE_RECORDINGS} are deleted; imports are never trimmed.
 */
async function storeRecording(recording: TelemetryRecording, frames: TelemetryFrame[]): Promise<void> {
  await idbSet(`${IDB_RECORDINGS_PREFIX}${recording.id}`, frames);
  await mutateIndex(async (index) => {
    const next = index.filter((r) => r.id !== recording.id);
    next.push(recording);
    let excess = next.filter((r) => !r.imported).length - MAX_LIVE_RECORDINGS;
    if (excess <= 0) return next;
    const kept: TelemetryRecording[] = [];
    for (const r of next) {
      if (excess > 0 && !r.imported) {
        excess--;
        await idbDel(`${IDB_RECORDINGS_PREFIX}${r.id}`);
      } else {
        kept.push(r);
      }
    }
    return kept;
  });
}

// ── Internal: persist a slot ─────────────────────────────────

async function finalizeSlot(slotKey: string, slot: RecorderSlot): Promise<TelemetryRecording> {
  // Leave the slot map before the first await: the drone is no longer
  // recording, so a re-arm during the IndexedDB writes starts a fresh slot
  // instead of being mistaken for this one.
  _slots.delete(slotKey);
  if (slot.droneId !== undefined) {
    const mirrors = _mirrors.get(slot.droneId);
    mirrors?.delete(slotKey);
    if (mirrors?.size === 0) _mirrors.delete(slot.droneId);
  }

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
    // Finalize markers alongside frames/duration. Omit the field entirely
    // when none were placed so the persisted shape stays minimal.
    markers: slot.markers.length > 0 ? slot.markers.map((m) => ({ ...m })) : undefined,
  };
  await storeRecording(recording, slot.frames);
  return recording;
}

function recordingOf(
  id: string,
  name: string,
  frames: TelemetryFrame[],
  options: { droneId?: string; droneName?: string; startTimeMs?: number },
): TelemetryRecording {
  const startTime = options.startTimeMs ?? Date.now();
  const lastOffsetMs = frames.length > 0 ? frames[frames.length - 1].offsetMs : 0;
  const channels = new Set<string>();
  for (const frame of frames) channels.add(frame.channel);
  return {
    id,
    name,
    startTime,
    endTime: startTime + lastOffsetMs,
    durationMs: lastOffsetMs,
    frameCount: frames.length,
    channels: Array.from(channels),
    droneId: options.droneId,
    droneName: options.droneName,
  };
}

/**
 * Store the frames of one flight cut from a longer live recording (see
 * {@link recordingFramesBetween}) as a live recording of its own. It counts
 * toward the live-recording cap like any other.
 */
export async function saveFlightRecording(
  frames: TelemetryFrame[],
  options: { droneId: string; droneName?: string; startTimeMs: number },
): Promise<TelemetryRecording> {
  const id = `rec-${options.startTimeMs}-${Math.random().toString(36).slice(2, 8)}`;
  const recording = recordingOf(id, `Recording ${new Date(options.startTimeMs).toLocaleString()}`, frames, options);
  await storeRecording(recording, frames);
  return recording;
}

/**
 * Insert a fully-formed recording into IDB without going through the live
 * arm/disarm slot machinery. Used by importers (dataflash, ULog, tlog) that
 * already have all frames in memory and just need them stored
 * + indexed so the existing Charts/Replay/Analysis pipeline can read them.
 *
 * Caller is responsible for choosing a unique `id` (e.g. `dataflash-<uuid>`).
 * Imported recordings are exempt from the live-recording cap: the user
 * explicitly asked to import them. Re-importing the same id replaces it.
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
  const recording: TelemetryRecording = { ...recordingOf(id, name, frames, options), imported: true };
  await storeRecording(recording, frames);
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
  await mutateIndex(async (index) => index.filter((r) => r.id !== recordingId));
}
