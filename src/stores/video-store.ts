import { create } from "zustand";

// detected transport for the active video stream.
// "lan-whep"   = WHEP from a private/loopback URL (LAN direct, lowest latency)
// "p2p-mqtt"   = Direct WebRTC P2P, SDP signaling relayed via MQTT.
//                Cross-network via STUN.
// "cloud-whep" = deferred, kept in the type for future use
// "cloud-mse"  = deferred, kept in the type for future use
// "off"        = user selected "no video"
// "unknown"    = no stream OR transport not yet detected
export type VideoTransport =
  | "lan-whep"
  | "p2p-mqtt"
  | "cloud-whep"
  | "cloud-mse"
  | "off"
  | "unknown";

// user preference for transport selection. Persisted via settings-store
// to IndexedDB so it survives across sessions.
export type VideoTransportMode =
  | "auto"       // cascade: lan-whep → p2p-mqtt
  | "lan-whep"   // pin to LAN direct
  | "p2p-mqtt"   // pin to P2P MQTT
  | "off";       // no video

// per-mode health state for the dropdown indicator. Updated in real
// time by the cascade hook as it tries each mode.
export type TransportAttemptStage =
  | "idle"
  | "starting"
  | "ice-gathering"
  | "sdp-exchange"
  | "ontrack-wait"
  | "connected";

export type TransportErrorCode =
  | "ice-gather-timeout"
  | "ice-disconnect"
  | "sdp-exchange-timeout"
  | "mqtt-connect-timeout"
  | "mqtt-subscribe-failed"
  | "mqtt-answer-timeout"
  | "whep-4xx"
  | "whep-5xx"
  | "whep-network"
  | "ontrack-timeout"
  | "prereq-missing"
  // cascade-level withTimeout fired before the mode finished its own
  // internal stages. Distinct from per-stage timeouts.
  | "cascade-timeout"
  // AbortSignal fired (cascade was cancelled by mode change or
  // component unmount).
  | "aborted"
  | "other";

export interface TransportHealth {
  state: "unknown" | "testing" | "ok" | "failed";
  lastError: string | null;
  lastTriedAt: number | null;
  // connection establishment time in ms (from start of attempt to first
  // frame), captured once on success. Distinct from
  // useVideoStore.latencyMs which is the LIVE network RTT polled from
  // RTCPeerConnection stats every second.
  connectMs: number | null;
  lastErrorCode: TransportErrorCode | null;
  lastAttemptStage: TransportAttemptStage | null;
}

const emptyHealth = (): TransportHealth => ({
  state: "unknown",
  lastError: null,
  lastTriedAt: null,
  connectMs: null,
  lastErrorCode: null,
  lastAttemptStage: null,
});

// Rich latency breakdown surfaced behind the bottom-strip chip. Phase A
// fills the GCS-receive + agent-air-side fields; Phase B adds true
// camera->monitor glass-to-glass via SEI parsing in the browser.
export interface VideoLatencyBreakdown {
  // GCS receive side (from RTCPeerConnection.getStats)
  rttMs: number;                  // candidate-pair currentRoundTripTime * 1000
  jitterBufferMs: number;         // per-window jitterBufferDelay (decoder wait)
  rtpJitterMs: number;            // inbound-rtp.jitter * 1000 (network variance)
  framesDecoded: number;
  framesDropped: number;
  // Agent air side (from GET /api/video/latency)
  airLatencyMs: number | null;    // SEI EWMA, camera -> drone LCD
  airSamples: number | null;
  airSource: string | null;       // "sei" | "unavailable" | "read_failed" | ...
  // True end-to-end (Phase B, from browser SEI parser + presentationTime)
  trueG2GMs: number | null;       // camera -> browser presented frame
  trueG2GStdDevMs: number | null; // std-dev over the last 30 samples
  // Drone <-> browser clock offset (Cristian's algorithm via /api/time)
  clockOffsetMs: number | null;   // signed: positive means drone clock ahead
  clockOffsetUncertaintyMs: number | null;
  updatedAt: number;              // Date.now() of last write
}

const emptyBreakdown = (): VideoLatencyBreakdown => ({
  rttMs: 0,
  jitterBufferMs: 0,
  rtpJitterMs: 0,
  framesDecoded: 0,
  framesDropped: 0,
  airLatencyMs: null,
  airSamples: null,
  airSource: null,
  trueG2GMs: null,
  trueG2GStdDevMs: null,
  clockOffsetMs: null,
  clockOffsetUncertaintyMs: null,
  updatedAt: 0,
});

interface VideoStoreState {
  streamUrl: string | null;
  isStreaming: boolean;
  isRecording: boolean;
  fps: number;
  latencyMs: number;
  resolution: string;

  // extended WebRTC stats
  codec: string;            // e.g. "H264" or "VP8"
  bitrateKbps: number;      // derived from bytesReceived delta
  packetsLost: number;      // cumulative
  jitterMs: number;         // from inbound-rtp.jitter (sec * 1000)
  transport: VideoTransport;

  // Rich latency breakdown. latencyMs above remains the sum
  // (rttMs + jitterBufferMs) for backward compatibility with code that
  // only needs the single roll-up number.
  latency: VideoLatencyBreakdown;

  // HMR-safe polling state. Module-level globals in webrtc-client.ts
  // get reset every time Turbopack reloads the module (which happens on
  // any unrelated file change in the dev server). The FPS counter delta
  // computation needs persistent state across polls. Zustand stores
  // live on globalThis and survive HMR cleanly.
  _pollState: {
    lastFrameTime: number;
    lastFramesDecoded: number;
    lastStatsTime: number;
    lastBytesReceived: number;
    lastJitterDelay: number;
    lastJitterEmitted: number;
    // Wall-clock of the last poll where framesDecoded OR bytesReceived
    // advanced. The frozen-stream watchdog compares the gap against a
    // threshold to detect a silent stall. Reset on visibilitychange so a
    // backgrounded tab (frame production legitimately pauses) does not
    // false-trigger a reconnect.
    lastProgressTime: number;
  };
  setPollState: (s: Partial<VideoStoreState["_pollState"]>) => void;
  resetPollState: () => void;

  // per-mode transport health. Keyed by VideoTransport. Cascade hook
  // and UX switcher both read/write this map.
  transportHealth: Record<VideoTransport, TransportHealth>;
  setTransportHealth: (t: VideoTransport, h: Partial<TransportHealth>) => void;
  resetTransportHealth: () => void;

  // Frozen-stream signal. The stats poller increments this when frames
  // and bytes are both flat while the peer connection still reports
  // "connected" — a silent decoder/transport stall that the native
  // connectionstatechange handler never sees. Video surfaces watch this
  // counter and re-fetch the offer (WHEP cannot renegotiate in place),
  // so the bump acts as a one-way "tear down and reconnect" edge.
  videoStallSignal: number;
  signalVideoStall: () => void;

  // Cloud video state
  cloudStreamUrl: string | null;
  cloudStreaming: boolean;

  // Agent video status (from /api/video polling)
  agentVideoState: string;
  agentWhepUrl: string | null;
  agentDependencies: Record<string, { found: boolean }> | null;
  // The stream switcher's active concurrent leg WHEP URL, when the operator
  // selected a non-default video stream. It wins over `agentWhepUrl` (which the
  // status poller owns + rewrites every tick), so a leg selection survives polls
  // instead of snapping back to the default leg. `null` ⇒ the default leg.
  whepUrlOverride: string | null;
  setWhepUrlOverride: (url: string | null) => void;

  setStreamUrl: (url: string | null) => void;
  setStreaming: (isStreaming: boolean) => void;
  setRecording: (isRecording: boolean) => void;
  updateStats: (fps: number, latencyMs: number) => void;
  setResolution: (resolution: string) => void;
  setVideoMetrics: (m: { codec?: string; bitrateKbps?: number; packetsLost?: number; jitterMs?: number }) => void;
  setTransport: (transport: VideoTransport) => void;
  setCloudStreamUrl: (url: string | null) => void;
  setCloudStreaming: (streaming: boolean) => void;
  setAgentVideoStatus: (state: string, whepUrl: string | null, deps?: Record<string, { found: boolean }>) => void;
  // Latency breakdown setters. Each writer touches only its own slice
  // so the polls/parsers don't fight each other on every update.
  setReceiveLatency: (m: { rttMs?: number; jitterBufferMs?: number; rtpJitterMs?: number; framesDecoded?: number; framesDropped?: number }) => void;
  setAirLatency: (m: { airLatencyMs?: number | null; airSamples?: number | null; airSource?: string | null }) => void;
  setClockOffset: (m: { clockOffsetMs: number | null; clockOffsetUncertaintyMs: number | null }) => void;
  // Records one G2G sample and recomputes the rolling EWMA + std-dev
  // surfaced in latency.trueG2GMs / latency.trueG2GStdDevMs. Caller
  // supplies the wall-clock-corrected glass-to-glass delta in ms.
  recordG2GSample: (ms: number) => void;
  resetLatency: () => void;
  /**
   * Reset the single-slot video state that bleeds across a drone selection
   * switch: the agent video status + WHEP URL, the live stream URL, and the
   * poll / latency / transport-health scratch state. Called from
   * `drone-manager.selectDrone` when the selected node changes so the newly
   * focused drone never inherits the previous one's stream or stats.
   */
  clearForSelection: () => void;
}

// Module-local ring buffer for the last N G2G samples. Lives outside
// the store because (a) it's per-tab and (b) we don't want every push
// to trigger a re-render — only the recomputed EWMA + std-dev do.
const G2G_RING_SIZE = 30;
const g2gRing: number[] = [];

function pushG2G(ms: number): { ewma: number; stddev: number } {
  g2gRing.push(ms);
  if (g2gRing.length > G2G_RING_SIZE) g2gRing.shift();
  const mean = g2gRing.reduce((a, b) => a + b, 0) / g2gRing.length;
  const variance =
    g2gRing.reduce((acc, v) => acc + (v - mean) ** 2, 0) / g2gRing.length;
  return { ewma: mean, stddev: Math.sqrt(variance) };
}

export const useVideoStore = create<VideoStoreState>((set) => ({
  streamUrl: null,
  isStreaming: false,
  isRecording: false,
  fps: 0,
  latencyMs: 0,
  resolution: "1280x720",

  codec: "",
  bitrateKbps: 0,
  packetsLost: 0,
  jitterMs: 0,
  transport: "unknown",

  latency: emptyBreakdown(),

  _pollState: {
    lastFrameTime: 0,
    lastFramesDecoded: 0,
    lastStatsTime: 0,
    lastBytesReceived: 0,
    lastJitterDelay: 0,
    lastJitterEmitted: 0,
    lastProgressTime: 0,
  },

  transportHealth: {
    "lan-whep": emptyHealth(),
    "p2p-mqtt": emptyHealth(),
    "cloud-whep": emptyHealth(),
    "cloud-mse": emptyHealth(),
    "off": emptyHealth(),
    "unknown": emptyHealth(),
  },

  videoStallSignal: 0,

  cloudStreamUrl: null,
  cloudStreaming: false,

  agentVideoState: "unknown",
  agentWhepUrl: null,
  whepUrlOverride: null,
  agentDependencies: null,

  setStreamUrl: (streamUrl) => set({ streamUrl }),
  setStreaming: (isStreaming) => set({ isStreaming }),
  setRecording: (isRecording) => set({ isRecording }),
  updateStats: (fps, latencyMs) => set({ fps, latencyMs }),
  setResolution: (resolution) => set({ resolution }),
  setVideoMetrics: (m) =>
    set((s) => ({
      codec: m.codec ?? s.codec,
      bitrateKbps: m.bitrateKbps ?? s.bitrateKbps,
      packetsLost: m.packetsLost ?? s.packetsLost,
      jitterMs: m.jitterMs ?? s.jitterMs,
    })),
  setTransport: (transport) => set({ transport }),
  setPollState: (s) =>
    set((prev) => ({ _pollState: { ...prev._pollState, ...s } })),
  resetPollState: () =>
    set({
      _pollState: {
        lastFrameTime: 0,
        lastFramesDecoded: 0,
        lastStatsTime: 0,
        lastBytesReceived: 0,
        lastJitterDelay: 0,
        lastJitterEmitted: 0,
        lastProgressTime: 0,
      },
    }),
  setTransportHealth: (t, h) =>
    set((prev) => ({
      transportHealth: {
        ...prev.transportHealth,
        [t]: { ...prev.transportHealth[t], ...h, lastTriedAt: Date.now() },
      },
    })),
  resetTransportHealth: () =>
    set({
      transportHealth: {
        "lan-whep": emptyHealth(),
        "p2p-mqtt": emptyHealth(),
        "cloud-whep": emptyHealth(),
        "cloud-mse": emptyHealth(),
        "off": emptyHealth(),
        "unknown": emptyHealth(),
      },
    }),
  signalVideoStall: () => set((prev) => ({ videoStallSignal: prev.videoStallSignal + 1 })),
  setCloudStreamUrl: (cloudStreamUrl) => set({ cloudStreamUrl }),
  setCloudStreaming: (cloudStreaming) => set({ cloudStreaming }),
  setAgentVideoStatus: (agentVideoState, agentWhepUrl, deps) =>
    set({ agentVideoState, agentWhepUrl, agentDependencies: deps ?? null }),
  setWhepUrlOverride: (whepUrlOverride) => set({ whepUrlOverride }),
  setReceiveLatency: (m) =>
    set((prev) => ({
      latency: {
        ...prev.latency,
        rttMs: m.rttMs ?? prev.latency.rttMs,
        jitterBufferMs: m.jitterBufferMs ?? prev.latency.jitterBufferMs,
        rtpJitterMs: m.rtpJitterMs ?? prev.latency.rtpJitterMs,
        framesDecoded: m.framesDecoded ?? prev.latency.framesDecoded,
        framesDropped: m.framesDropped ?? prev.latency.framesDropped,
        updatedAt: Date.now(),
      },
    })),
  setAirLatency: (m) =>
    set((prev) => ({
      latency: {
        ...prev.latency,
        airLatencyMs:
          m.airLatencyMs !== undefined ? m.airLatencyMs : prev.latency.airLatencyMs,
        airSamples:
          m.airSamples !== undefined ? m.airSamples : prev.latency.airSamples,
        airSource:
          m.airSource !== undefined ? m.airSource : prev.latency.airSource,
        updatedAt: Date.now(),
      },
    })),
  setClockOffset: (m) =>
    set((prev) => ({
      latency: {
        ...prev.latency,
        clockOffsetMs: m.clockOffsetMs,
        clockOffsetUncertaintyMs: m.clockOffsetUncertaintyMs,
        updatedAt: Date.now(),
      },
    })),
  recordG2GSample: (ms) => {
    const { ewma, stddev } = pushG2G(ms);
    set((prev) => ({
      latency: {
        ...prev.latency,
        trueG2GMs: ewma,
        trueG2GStdDevMs: stddev,
        updatedAt: Date.now(),
      },
    }));
  },
  resetLatency: () => {
    g2gRing.length = 0;
    set({ latency: emptyBreakdown() });
  },
  clearForSelection: () => {
    g2gRing.length = 0;
    set({
      agentVideoState: "unknown",
      agentWhepUrl: null,
  whepUrlOverride: null,
      agentDependencies: null,
      streamUrl: null,
      isStreaming: false,
      cloudStreamUrl: null,
      cloudStreaming: false,
      transport: "unknown",
      latency: emptyBreakdown(),
      _pollState: {
        lastFrameTime: 0,
        lastFramesDecoded: 0,
        lastStatsTime: 0,
        lastBytesReceived: 0,
        lastJitterDelay: 0,
        lastJitterEmitted: 0,
        lastProgressTime: 0,
      },
      transportHealth: {
        "lan-whep": emptyHealth(),
        "p2p-mqtt": emptyHealth(),
        "cloud-whep": emptyHealth(),
        "cloud-mse": emptyHealth(),
        "off": emptyHealth(),
        "unknown": emptyHealth(),
      },
    });
  },
}));
