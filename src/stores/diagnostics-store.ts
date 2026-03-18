import { create } from "zustand";
import { RingBuffer } from "@/lib/ring-buffer";

export interface MessageLogEntry {
  timestamp: number;
  msgId: number;
  msgName: string;
  direction: "in" | "out";
  size: number;
  /** Raw frame bytes for hex inspector (last 50 only) */
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
  updateCommandQueueSnapshot: (snapshot: CommandQueueSnapshot) => void;
  updateRingBufferInfo: (info: RingBufferInfo[]) => void;
  recordParseEvent: () => void;
  recordCallbackLatency: (latencyMs: number) => void;
  recordFrameProcessingTime: (timeMs: number) => void;
  updatePerformanceMetrics: () => void;
  clear: () => void;
}

const RATE_WINDOW_MS = 5000;
const PERF_WINDOW_MS = 5000;
const MAX_PERF_SAMPLES = 500;
const MAX_CONNECTION_LOG = 500;
const MAX_CALIBRATION_HISTORY = 500;

export const useDiagnosticsStore = create<DiagnosticsStoreState>((set, get) => ({
  messageLog: new RingBuffer<MessageLogEntry>(2000),
  eventTimeline: new RingBuffer<EventTimelineEntry>(500),
  connectionLog: [],
  calibrationHistory: [],
  messageRates: new Map(),
  _lastConnectTimestamp: null,
  commandQueueSnapshot: { pendingCount: 0, entries: [], totalSent: 0, totalSuccess: 0, totalFailed: 0 },
  ringBufferInfo: [],
  performanceMetrics: { parseRateHz: 0, avgCallbackLatencyMs: 0, frameProcessingTimeMs: 0, lastUpdated: 0 },
  _parseTimestamps: new RingBuffer<number>(MAX_PERF_SAMPLES),
  _callbackLatencies: new RingBuffer<number>(MAX_PERF_SAMPLES),
  _frameProcessingTimes: new RingBuffer<number>(MAX_PERF_SAMPLES),

  logMessage: (msgId, msgName, direction, size, rawHex) => {
    const now = Date.now();
    get().messageLog.push({
      timestamp: now,
      msgId,
      msgName,
      direction,
      size,
      rawHex,
    });

    // Track timestamps per message type for rate calculation
    // Mutate in place — updateRates() (called on interval) triggers re-render
    const rates = get().messageRates;
    const entry = rates.get(msgId);
    if (entry) {
      entry.timestamps.push(now);
    } else {
      rates.set(msgId, { msgId, msgName, timestamps: [now], hz: 0 });
    }
  },

  logEvent: (type, description) => {
    get().eventTimeline.push({
      timestamp: Date.now(),
      type,
      description,
    });
    set({ eventTimeline: get().eventTimeline });
  },

  logConnection: (type, details, errorCategory) => {
    const now = Date.now();
    const log = get().connectionLog;

    if (type === "connect") {
      log.push({ type, timestamp: now, details });
      set({ connectionLog: [...log].slice(-MAX_CONNECTION_LOG), _lastConnectTimestamp: now });
      return;
    }

    if (type === "disconnect") {
      const connectTs = get()._lastConnectTimestamp;
      const durationMs = connectTs ? now - connectTs : undefined;
      log.push({ type, timestamp: now, details, durationMs });
      set({ connectionLog: [...log].slice(-MAX_CONNECTION_LOG), _lastConnectTimestamp: null });
      return;
    }

    if (type === "error") {
      log.push({ type, timestamp: now, details, errorCategory: errorCategory ?? "unknown" });
      set({ connectionLog: [...log].slice(-MAX_CONNECTION_LOG) });
      return;
    }

    // reconnect_attempt
    log.push({ type, timestamp: now, details });
    set({ connectionLog: [...log].slice(-MAX_CONNECTION_LOG) });
  },

  logCalibration: (type, result, extra) => {
    const history = get().calibrationHistory;
    history.push({
      type,
      result,
      timestamp: Date.now(),
      offsets: extra?.offsets,
      fitness: extra?.fitness,
      compassId: extra?.compassId,
      preCalOffsets: extra?.preCalOffsets,
    });
    set({ calibrationHistory: [...history].slice(-MAX_CALIBRATION_HISTORY) });
  },

  updateRates: () => {
    const now = Date.now();
    const cutoff = now - RATE_WINDOW_MS;
    const rates = get().messageRates;
    for (const [msgId, entry] of rates) {
      // Trim old timestamps
      entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
      if (entry.timestamps.length === 0) {
        // Prune stale entries to prevent unbounded Map growth
        rates.delete(msgId);
      } else {
        entry.hz = entry.timestamps.length / (RATE_WINDOW_MS / 1000);
      }
    }
    set({ messageRates: new Map(rates) });
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

  clear: () =>
    set({
      messageLog: new RingBuffer<MessageLogEntry>(2000),
      eventTimeline: new RingBuffer<EventTimelineEntry>(500),
      connectionLog: [],
      calibrationHistory: [],
      messageRates: new Map(),
      _lastConnectTimestamp: null,
      commandQueueSnapshot: { pendingCount: 0, entries: [], totalSent: 0, totalSuccess: 0, totalFailed: 0 },
      ringBufferInfo: [],
      performanceMetrics: { parseRateHz: 0, avgCallbackLatencyMs: 0, frameProcessingTimeMs: 0, lastUpdated: 0 },
      _parseTimestamps: new RingBuffer<number>(MAX_PERF_SAMPLES),
      _callbackLatencies: new RingBuffer<number>(MAX_PERF_SAMPLES),
      _frameProcessingTimes: new RingBuffer<number>(MAX_PERF_SAMPLES),
    }),
}));
