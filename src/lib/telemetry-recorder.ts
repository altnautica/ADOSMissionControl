/**
 * Telemetry recording system.
 *
 * Captures telemetry frames per drone with timestamps to IndexedDB for
 * later replay, export, and analysis. Recordings persist across sessions.
 *
 * Frames are stored in chunks of {@link RECORDING_CHUNK_FRAMES}: a live
 * recording writes each chunk as it fills, so a long flight never holds all
 * of its frames in memory and a storage failure loses at most the chunk being
 * written. When a write fails the recording stops capturing, keeps what was
 * stored, and is marked with `truncatedAtMs`.
 *
 * @module telemetry-recorder
 * @license GPL-3.0-only
 */

import { get as idbGet, set as idbSet, del as idbDel } from "idb-keyval";
import { useHistoryStore } from "@/stores/history-store";

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
   * the operator deletes them.
   */
  imported?: boolean;
  /**
   * Number of IndexedDB values the frames are split across. Absent means
   * one (a recording stored before chunking).
   */
  chunkCount?: number;
  /**
   * Set when storage failed during the recording: capture stopped at this
   * offset (ms from the recording start) and nothing after it was kept.
   */
  truncatedAtMs?: number;
}

// ── IDB Keys ─────────────────────────────────────────────────

const IDB_RECORDINGS_PREFIX = "altcmd:recording:";
const IDB_RECORDINGS_INDEX = "altcmd:recordings-index";

// ── Recorder ─────────────────────────────────────────────────

/** A slot is recording while it is in {@link _slots}; finalizing removes it first. */
interface RecorderSlot {
  startTime: number;
  /** Frames not yet handed to IndexedDB. */
  frames: TelemetryFrame[];
  channels: Set<string>;
  recordingId: string;
  droneId?: string;
  droneName?: string;
  /** Timeline markers placed during the recording. */
  markers: RecordingMarker[];
  /** Last write timestamp per channel for rate limiting (ms since epoch). */
  lastWriteAt: Map<string, number>;
  /** Chunks handed to IndexedDB (written or queued). */
  chunkCount: number;
  /** Frames whose chunk write completed. */
  storedFrames: number;
  /** The chain of chunk writes, in order; finalize and reads wait on it. */
  flushing: Promise<void>;
  /** Offset capture stopped at after a chunk write failed. */
  truncatedAtMs?: number;
}

/**
 * Per-channel max sample rate in Hz. Frames received above this rate are
 * silently dropped to keep IndexedDB payloads under control.
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

/** Frames per stored chunk. */
export const RECORDING_CHUNK_FRAMES = 50_000;

/**
 * Live recordings no flight record uses (manual, record-on-connect and plugin
 * recordings) kept in the index; the oldest beyond this are deleted. A
 * recording a flight in history uses is never deleted to make room.
 */
export const MAX_UNREFERENCED_LIVE_RECORDINGS = 20;

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
    chunkCount: 0,
    storedFrames: 0,
    flushing: Promise.resolve(),
  };
}

// ── Storage failure notification ─────────────────────────────

type StorageFailureListener = (err: unknown) => void;
const _storageFailureListeners = new Set<StorageFailureListener>();

/**
 * Be told when telemetry could not be written to storage (a recording chunk,
 * or a flight's recording). Returns the unsubscribe function.
 */
export function onRecordingStorageFailure(listener: StorageFailureListener): () => void {
  _storageFailureListeners.add(listener);
  return () => {
    _storageFailureListeners.delete(listener);
  };
}

/** Tell every listener that telemetry could not be stored. */
export function reportRecordingStorageFailure(err: unknown): void {
  console.warn("[telemetry-recorder] telemetry could not be stored", err);
  for (const listener of _storageFailureListeners) listener(err);
}

function chunkKey(recordingId: string, index: number): string {
  return index === 0 ? `${IDB_RECORDINGS_PREFIX}${recordingId}` : `${IDB_RECORDINGS_PREFIX}${recordingId}:${index}`;
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
  if (slot.truncatedAtMs !== undefined) return;

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
  if (slot.frames.length >= RECORDING_CHUNK_FRAMES) flushChunk(slot);
}

/**
 * Hand the slot's buffered frames to IndexedDB as its next chunk. Writes run
 * in order. A failed write stops the recording at the start of that chunk:
 * later frames are discarded and the operator is told.
 */
function flushChunk(slot: RecorderSlot): void {
  const chunk = slot.frames;
  const index = slot.chunkCount;
  slot.frames = [];
  slot.chunkCount = index + 1;
  slot.flushing = slot.flushing.then(async () => {
    if (slot.truncatedAtMs !== undefined) return;
    try {
      await idbSet(chunkKey(slot.recordingId, index), chunk);
      slot.storedFrames += chunk.length;
    } catch (err) {
      slot.truncatedAtMs = chunk[0]?.offsetMs ?? Date.now() - slot.startTime;
      slot.chunkCount = index;
      slot.frames = [];
      reportRecordingStorageFailure(err);
    }
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

/**
 * The recording currently capturing {@link droneId}'s frames, if any.
 * `truncatedAtMs` is set once storage failed and capture stopped.
 */
export function activeRecordingFor(
  droneId: string,
): { recordingId: string; startTime: number; truncatedAtMs?: number } | undefined {
  const slot = _slots.get(droneId);
  return slot
    ? { recordingId: slot.recordingId, startTime: slot.startTime, truncatedAtMs: slot.truncatedAtMs }
    : undefined;
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
    frames = await liveSlotFrames(slot);
  } else {
    const stored = (await listRecordings()).find((r) => r.id === recordingId);
    if (!stored) return [];
    startTime = stored.startTime;
    frames = await readChunks(recordingId, stored.chunkCount ?? 1);
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

/** Every frame a live slot holds: its written chunks, then the buffered tail. */
async function liveSlotFrames(slot: RecorderSlot): Promise<TelemetryFrame[]> {
  // Snapshot synchronously: every chunk below `queued` is on the chain
  // captured here, and `tail` holds the frames after them.
  const tail = slot.frames;
  const queued = slot.chunkCount;
  await slot.flushing;
  const written = await readChunks(slot.recordingId, Math.min(queued, slot.chunkCount));
  if (slot.truncatedAtMs === undefined) return written.concat(tail);
  const cut = slot.truncatedAtMs;
  return written.concat(tail.filter((f) => f.offsetMs < cut));
}

async function readChunks(recordingId: string, chunkCount: number): Promise<TelemetryFrame[]> {
  const out: TelemetryFrame[] = [];
  for (let i = 0; i < chunkCount; i++) {
    const chunk = (await idbGet(chunkKey(recordingId, i))) as TelemetryFrame[] | undefined;
    if (chunk) for (const f of chunk) out.push(f);
  }
  return out;
}

async function deleteChunks(recordingId: string, chunkCount: number): Promise<void> {
  for (let i = 0; i < chunkCount; i++) await idbDel(chunkKey(recordingId, i));
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

/** Recording ids used by flight records that are not in the trash. */
async function referencedRecordingIds(): Promise<Set<string>> {
  await useHistoryStore.getState().ensureLoaded();
  const ids = new Set<string>();
  for (const r of useHistoryStore.getState().records) {
    if (!r.deleted && r.recordingId) ids.add(r.recordingId);
  }
  return ids;
}

/**
 * Add {@link recording} to the index, replacing an entry with the same id.
 * Live recordings no active flight record uses are kept to the newest
 * {@link MAX_UNREFERENCED_LIVE_RECORDINGS}; a recording a flight in history
 * uses, an import, and the recording being added are never deleted. A
 * trashed record whose recording is deleted stops claiming telemetry.
 */
async function indexRecording(recording: TelemetryRecording): Promise<void> {
  const referenced = await referencedRecordingIds();
  const evicted: string[] = [];
  await mutateIndex(async (index) => {
    const next = index.filter((r) => r.id !== recording.id);
    next.push(recording);
    const unreferenced = (r: TelemetryRecording) => !r.imported && !referenced.has(r.id);
    let excess = next.filter(unreferenced).length - MAX_UNREFERENCED_LIVE_RECORDINGS;
    if (excess <= 0) return next;
    const kept: TelemetryRecording[] = [];
    for (const r of next) {
      if (excess > 0 && r.id !== recording.id && unreferenced(r)) {
        excess--;
        await deleteChunks(r.id, r.chunkCount ?? 1);
        evicted.push(r.id);
      } else {
        kept.push(r);
      }
    }
    return kept;
  });
  if (evicted.length === 0) return;
  const gone = new Set(evicted);
  const history = useHistoryStore.getState();
  const orphaned = history.records.filter((r) => r.recordingId !== undefined && gone.has(r.recordingId));
  if (orphaned.length === 0) return;
  for (const r of orphaned) history.updateRecord(r.id, { recordingId: undefined, hasTelemetry: false });
  await history.persistToIDB();
}

/**
 * Store {@link frames} as {@link recording}'s chunks and index it. A failed
 * write removes the chunks already written and rejects, so nothing half
 * stored is left behind.
 */
async function storeRecording(recording: TelemetryRecording, frames: TelemetryFrame[]): Promise<TelemetryRecording> {
  const chunkCount = Math.max(1, Math.ceil(frames.length / RECORDING_CHUNK_FRAMES));
  let written = 0;
  try {
    for (; written < chunkCount; written++) {
      const from = written * RECORDING_CHUNK_FRAMES;
      await idbSet(chunkKey(recording.id, written), frames.slice(from, from + RECORDING_CHUNK_FRAMES));
    }
  } catch (err) {
    await deleteChunks(recording.id, written).catch(() => undefined);
    throw err;
  }
  const stored: TelemetryRecording = { ...recording, chunkCount };
  await indexRecording(stored);
  return stored;
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
  if (slot.truncatedAtMs === undefined && (slot.frames.length > 0 || slot.chunkCount === 0)) {
    flushChunk(slot);
  }
  await slot.flushing;
  const recording: TelemetryRecording = {
    id: slot.recordingId,
    name: `Recording ${new Date(slot.startTime).toLocaleString()}`,
    startTime: slot.startTime,
    endTime,
    durationMs: endTime - slot.startTime,
    frameCount: slot.storedFrames,
    channels: Array.from(slot.channels),
    droneId: slot.droneId,
    droneName: slot.droneName,
    // Finalize markers alongside frames/duration. Omit the field entirely
    // when none were placed so the persisted shape stays minimal.
    markers: slot.markers.length > 0 ? slot.markers.map((m) => ({ ...m })) : undefined,
    chunkCount: slot.chunkCount,
    ...(slot.truncatedAtMs !== undefined ? { truncatedAtMs: slot.truncatedAtMs } : {}),
  };
  await indexRecording(recording);
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
 * {@link recordingFramesBetween}) as a live recording of its own. Rejects
 * when storage fails; nothing is left stored then.
 */
export async function saveFlightRecording(
  frames: TelemetryFrame[],
  options: { droneId: string; droneName?: string; startTimeMs: number; truncatedAtMs?: number },
): Promise<TelemetryRecording> {
  const id = `rec-${options.startTimeMs}-${Math.random().toString(36).slice(2, 8)}`;
  const recording = recordingOf(id, `Recording ${new Date(options.startTimeMs).toLocaleString()}`, frames, options);
  if (options.truncatedAtMs !== undefined) recording.truncatedAtMs = options.truncatedAtMs;
  return await storeRecording(recording, frames);
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
  return await storeRecording(recording, frames);
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
  const entry = (await listRecordings()).find((r) => r.id === recordingId);
  return readChunks(recordingId, entry?.chunkCount ?? 1);
}

/**
 * Delete a recording.
 */
export async function deleteRecording(recordingId: string): Promise<void> {
  const entry = (await listRecordings()).find((r) => r.id === recordingId);
  await deleteChunks(recordingId, entry?.chunkCount ?? 1);
  await mutateIndex(async (index) => index.filter((r) => r.id !== recordingId));
}
