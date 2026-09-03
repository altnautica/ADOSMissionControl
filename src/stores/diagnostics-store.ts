import { create } from "zustand";
import { RingBuffer } from "@/lib/ring-buffer";
import { createVersionBumper } from "./coalesced-version";

export interface MessageLogEntry {
  timestamp: number;
  msgId: number;
  msgName: string;
  direction: "in" | "out";
  size: number;
  /**
   * Raw frame bytes, pre-formatted as hex, for the hex inspector.
   *
   * The producer already gates capture: `MAVLinkAdapter.diagnosticsEnabled`
   * is set true only while the Frames tab is mounted
   * (`components/diagnostics/DiagnosticsPanel.tsx`), so nothing is formatted
   * on a closed panel. This field is additionally released off all but the
   * newest {@link RAW_HEX_RETAIN} entries — the inspector only ever renders
   * the last 50, so retaining hex across the whole 2000-slot log pinned
   * ~200 KB of strings for rows no surface can reach.
   */
  rawHex?: string;
}

export type EventType =
  | "connect"
  | "disconnect"
  | "arm"
  | "disarm"
  | "mode_change"
  | "error"
  | "calibration"
  | "param_write"
  | "flash_commit"
  | "mission_upload"
  | "mission_download"
  | "reconnect_attempt";

export type ErrorCategory =
  | "timeout"
  | "crc_failure"
  | "transport_error"
  | "parse_error"
  | "unknown";

export interface EventTimelineEntry {
  timestamp: number;
  type: EventType;
  description: string;
}

export interface ConnectionLogEntry {
  type: "connect" | "disconnect" | "error" | "reconnect_attempt";
  timestamp: number;
  details: string;
  /** Duration in ms (set on disconnect, computed from matching connect) */
  durationMs?: number;
  /** Error classification for error entries */
  errorCategory?: ErrorCategory;
}

export interface CalibrationHistoryEntry {
  type: string;
  result: "success" | "failed" | "cancelled";
  timestamp: number;
  /** Compass offset data from MAG_CAL_REPORT */
  offsets?: { ofsX: number; ofsY: number; ofsZ: number };
  /** Calibration fitness value from MAG_CAL_REPORT */
  fitness?: number;
  /** Compass ID from MAG_CAL_REPORT */
  compassId?: number;
  /** Pre-calibration offsets for before/after comparison */
  preCalOffsets?: { ofsX: number; ofsY: number; ofsZ: number };
}

export interface MessageRateEntry {
  msgId: number;
  msgName: string;
  timestamps: number[];
  hz: number;
}

/** Command queue snapshot for display */
export interface CommandQueueSnapshot {
  pendingCount: number;
  entries: { command: number; commandName: string; timestamp: number }[];
  totalSent: number;
  totalSuccess: number;
  totalFailed: number;
}

/** Ring buffer utilization info */
export interface RingBufferInfo {
  name: string;
  capacity: number;
  length: number;
  fillPct: number;
}

/** Performance metrics from browser performance API */
export interface PerformanceMetrics {
  parseRateHz: number;
  avgCallbackLatencyMs: number;
  frameProcessingTimeMs: number;
  lastUpdated: number;
}

interface DiagnosticsStoreState {
  messageLog: RingBuffer<MessageLogEntry>;
  eventTimeline: RingBuffer<EventTimelineEntry>;
  connectionLog: ConnectionLogEntry[];
  calibrationHistory: CalibrationHistoryEntry[];
  messageRates: Map<number, MessageRateEntry>;
  /** Monotonic counter bumped on every mutation so selectors re-render. */
  _version: number;

  /** Timestamp of most recent connect event, used to compute duration on disconnect */
  _lastConnectTimestamp: number | null;

  /** Command queue status snapshot */
  commandQueueSnapshot: CommandQueueSnapshot;

  /** Ring buffer utilization snapshots */
  ringBufferInfo: RingBufferInfo[];

  /** Performance metrics */
  performanceMetrics: PerformanceMetrics;

  /** Tracking ring buffers for perf calculation (O(1) push, no splice) */
  _parseTimestamps: RingBuffer<number>;
  _callbackLatencies: RingBuffer<number>;
  _frameProcessingTimes: RingBuffer<number>;

  logMessage: (msgId: number, msgName: string, direction: "in" | "out", size: number, rawHex?: string) => void;
  logEvent: (type: EventType, description: string) => void;
  logConnection: (type: "connect" | "disconnect" | "error" | "reconnect_attempt", details: string, errorCategory?: ErrorCategory) => void;
  logCalibration: (type: string, result: "success" | "failed" | "cancelled", extra?: {
    offsets?: { ofsX: number; ofsY: number; ofsZ: number };
    fitness?: number;
    compassId?: number;
    preCalOffsets?: { ofsX: number; ofsY: number; ofsZ: number };
  }) => void;
  updateRates: () => void;
  /** Release retained `rawHex` off every log entry (the Frames tab closed). */
  releaseRawHex: () => void;
  updateCommandQueueSnapshot: (snapshot: CommandQueueSnapshot) => void;
  updateRingBufferInfo: (info: RingBufferInfo[]) => void;
  recordParseEvent: () => void;
  recordCallbackLatency: (latencyMs: number) => void;
  recordFrameProcessingTime: (timeMs: number) => void;
  updatePerformanceMetrics: () => void;
  clear: () => void;
}

const RATE_WINDOW_MS = 5000;
/**
 * Hard ceiling on per-message timestamp arrays. logMessage runs on every
 * inbound frame regardless of whether any rate consumer is mounted, so the
 * timestamps array must be bounded at push time and not rely on updateRates()
 * (only invoked while the rate panel is open) to trim. 600 entries covers
 * ~120 Hz across the 5 s rate window with headroom.
 */
const MAX_MSG_TIMESTAMPS = 600;
const PERF_WINDOW_MS = 5000;
const MAX_PERF_SAMPLES = 500;
const MAX_CONNECTION_LOG = 500;
const MAX_CALIBRATION_HISTORY = 500;

/**
 * How many of the newest `messageLog` entries keep their `rawHex`.
 *
 * `FrameInspector` renders `.filter(m => m.rawHex).slice(-50)`, so hex on any
 * older row is unreachable memory. 64 gives the inspector its full 50 rows
 * plus headroom for interleaved rows that carried no hex.
 */
export const RAW_HEX_RETAIN = 64;

/**
 * Coalesced `_version` bumper. `logMessage` runs on every decoded frame
 * (100-400 Hz on a full ArduPilot stream), so a `set()` per call re-rendered
 * the frame inspector, the message-rate panel and the event timeline at wire
 * rate. One bump per animation frame instead.
 */
const bumper = createVersionBumper(() =>
  useDiagnosticsStore.setState((s) => ({ _version: s._version + 1 })),
);
const scheduleVersionBump = bumper.scheduleVersionBump;

/** Test/debug affordance: true while a coalesced bump is pending. */
export const diagnosticsBumpPending = bumper.hasPendingBump;

export const useDiagnosticsStore = create<DiagnosticsStoreState>((set, get) => ({
  messageLog: new RingBuffer<MessageLogEntry>(2000),
  eventTimeline: new RingBuffer<EventTimelineEntry>(500),
  connectionLog: [],
  calibrationHistory: [],
  messageRates: new Map(),
  _lastConnectTimestamp: null,
  _version: 0,
  commandQueueSnapshot: { pendingCount: 0, entries: [], totalSent: 0, totalSuccess: 0, totalFailed: 0 },
  ringBufferInfo: [],
  performanceMetrics: { parseRateHz: 0, avgCallbackLatencyMs: 0, frameProcessingTimeMs: 0, lastUpdated: 0 },
  _parseTimestamps: new RingBuffer<number>(MAX_PERF_SAMPLES),
  _callbackLatencies: new RingBuffer<number>(MAX_PERF_SAMPLES),
  _frameProcessingTimes: new RingBuffer<number>(MAX_PERF_SAMPLES),

  logMessage: (msgId, msgName, direction, size, rawHex) => {
    const now = Date.now();
    const log = get().messageLog;
    log.push({
      timestamp: now,
      msgId,
      msgName,
      direction,
      size,
      rawHex,
    });
    // Release hex off the entry falling out of the retention window. One
    // constant-time step per push keeps at most RAW_HEX_RETAIN strings alive
    // without a sweep.
    if (rawHex !== undefined && log.length > RAW_HEX_RETAIN) {
      const evicted = log.get(log.length - 1 - RAW_HEX_RETAIN);
      if (evicted !== undefined) evicted.rawHex = undefined;
    }

    // Track timestamps per message type for rate calculation
    // Mutate in place — updateRates() (called on interval) triggers re-render
    const rates = get().messageRates;
    const entry = rates.get(msgId);
    if (entry) {
      const ts = entry.timestamps;
      ts.push(now);
      // Bound growth at push time, independent of updateRates(): prune any
      // timestamps older than the rate window from the head so a stopped
      // stream's entry does not pin a stale array, then cap by hard ceiling.
      const cutoff = now - RATE_WINDOW_MS;
      let drop = 0;
      while (drop < ts.length && ts[drop] <= cutoff) {
        drop++;
      }
      if (drop > 0) {
        ts.splice(0, drop);
      }
      if (ts.length > MAX_MSG_TIMESTAMPS) {
        ts.splice(0, ts.length - MAX_MSG_TIMESTAMPS);
      }
    } else {
      rates.set(msgId, { msgId, msgName, timestamps: [now], hz: 0 });
    }
    scheduleVersionBump();
  },

  logEvent: (type, description) => {
    get().eventTimeline.push({
      timestamp: Date.now(),
      type,
      description,
    });
    scheduleVersionBump();
  },

  logConnection: (type, details, errorCategory) => {
    const now = Date.now();
    const log = [...get().connectionLog];

    if (type === "connect") {
      log.push({ type, timestamp: now, details });
      set({ connectionLog: log.slice(-MAX_CONNECTION_LOG), _lastConnectTimestamp: now, _version: get()._version + 1 });
      return;
    }

    if (type === "disconnect") {
      const connectTs = get()._lastConnectTimestamp;
      const durationMs = connectTs ? now - connectTs : undefined;
      log.push({ type, timestamp: now, details, durationMs });
      set({ connectionLog: log.slice(-MAX_CONNECTION_LOG), _lastConnectTimestamp: null, _version: get()._version + 1 });
      return;
    }

    if (type === "error") {
      log.push({ type, timestamp: now, details, errorCategory: errorCategory ?? "unknown" });
      set({ connectionLog: log.slice(-MAX_CONNECTION_LOG), _version: get()._version + 1 });
      return;
    }

    // reconnect_attempt
    log.push({ type, timestamp: now, details });
    set({ connectionLog: log.slice(-MAX_CONNECTION_LOG), _version: get()._version + 1 });
  },

  logCalibration: (type, result, extra) => {
    const history = [...get().calibrationHistory];
    history.push({
      type,
      result,
      timestamp: Date.now(),
      offsets: extra?.offsets,
      fitness: extra?.fitness,
      compassId: extra?.compassId,
      preCalOffsets: extra?.preCalOffsets,
    });
    set({ calibrationHistory: history.slice(-MAX_CALIBRATION_HISTORY), _version: get()._version + 1 });
  },

  updateRates: () => {
    const now = Date.now();
    const cutoff = now - RATE_WINDOW_MS;
    const rates = get().messageRates;
    for (const [msgId, entry] of rates) {
      // Prune in place from the head. `logMessage` already trims to the same
      // cutoff on every push, so this normally drops nothing; the previous
      // `filter()` allocated a fresh array per message type per tick anyway.
      const ts = entry.timestamps;
      let drop = 0;
      while (drop < ts.length && ts[drop] <= cutoff) drop++;
      if (drop > 0) ts.splice(0, drop);
      if (ts.length === 0) {
        // Prune stale entries to prevent unbounded Map growth.
        rates.delete(msgId);
      } else {
        entry.hz = ts.length / (RATE_WINDOW_MS / 1000);
      }
    }
    // `MessageRatePanel` selects `messageRates` and memoizes on its identity,
    // so the clone is the panel's change signal and must stay. It is cheap:
    // this runs at 1 Hz and only while that panel is mounted. What was
    // expensive is the per-entry `filter()` above, now an in-place splice.
    set((s) => ({ messageRates: new Map(rates), _version: s._version + 1 }));
  },

  releaseRawHex: () => {
    let released = false;
    get().messageLog.forEach((entry) => {
      if (entry.rawHex !== undefined) {
        entry.rawHex = undefined;
        released = true;
      }
    });
    if (released) set((s) => ({ _version: s._version + 1 }));
  },

  updateCommandQueueSnapshot: (snapshot) => {
    set({ commandQueueSnapshot: snapshot });
  },

  updateRingBufferInfo: (info) => {
    set({ ringBufferInfo: info });
  },

  recordParseEvent: () => {
    get()._parseTimestamps.push(performance.now());
  },

  recordCallbackLatency: (latencyMs) => {
    get()._callbackLatencies.push(latencyMs);
  },

  recordFrameProcessingTime: (timeMs) => {
    get()._frameProcessingTimes.push(timeMs);
  },

  updatePerformanceMetrics: () => {
    const now = performance.now();
    const cutoff = now - PERF_WINDOW_MS;

    const tsArr = get()._parseTimestamps.toArray();
    const recentParses = tsArr.filter((t) => t > cutoff);
    const parseRateHz = recentParses.length / (PERF_WINDOW_MS / 1000);

    const recentLatencies = get()._callbackLatencies.last(100);
    const avgCallbackLatencyMs = recentLatencies.length > 0
      ? recentLatencies.reduce((a, b) => a + b, 0) / recentLatencies.length
      : 0;

    const recentFrameTimes = get()._frameProcessingTimes.last(100);
    const frameProcessingTimeMs = recentFrameTimes.length > 0
      ? recentFrameTimes.reduce((a, b) => a + b, 0) / recentFrameTimes.length
      : 0;

    set({
      performanceMetrics: {
        parseRateHz,
        avgCallbackLatencyMs,
        frameProcessingTimeMs,
        lastUpdated: Date.now(),
      },
    });
  },

  clear: () => {
    // A bump scheduled by a push earlier in this frame would otherwise land
    // after the reset and re-notify against the fresh buffers.
    bumper.cancelVersionBump();
    set({
      messageLog: new RingBuffer<MessageLogEntry>(2000),
      eventTimeline: new RingBuffer<EventTimelineEntry>(500),
      connectionLog: [],
      calibrationHistory: [],
      messageRates: new Map(),
      _lastConnectTimestamp: null,
      _version: 0,
      commandQueueSnapshot: { pendingCount: 0, entries: [], totalSent: 0, totalSuccess: 0, totalFailed: 0 },
      ringBufferInfo: [],
      performanceMetrics: { parseRateHz: 0, avgCallbackLatencyMs: 0, frameProcessingTimeMs: 0, lastUpdated: 0 },
      _parseTimestamps: new RingBuffer<number>(MAX_PERF_SAMPLES),
      _callbackLatencies: new RingBuffer<number>(MAX_PERF_SAMPLES),
      _frameProcessingTimes: new RingBuffer<number>(MAX_PERF_SAMPLES),
    });
  },
}));
