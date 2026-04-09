import { create } from "zustand";

// DEC-108 Phase D: detected transport for the active video stream.
// "lan-whep"   = WHEP from a private/loopback URL (LAN direct, lowest latency)
// "p2p-mqtt"   = Direct WebRTC P2P, SDP signaling relayed via MQTT
//                (DEC-108 Phase B0). Cross-network via STUN.
// "cloud-whep" = DEFERRED (DEC-107 Phase H) — kept in the type for future
// "cloud-mse"  = DEFERRED (DEC-107 Phase H) — kept in the type for future
// "off"        = User selected "no video" (DEC-107 Phase H)
// "unknown"    = No stream OR transport not yet detected
export type VideoTransport =
  | "lan-whep"
  | "p2p-mqtt"
  | "cloud-whep"
  | "cloud-mse"
  | "off"
  | "unknown";

// DEC-107 Phase H: user preference for transport selection. Persisted via
// settings-store to IndexedDB so it survives across sessions.
export type VideoTransportMode =
  | "auto"       // cascade: lan-whep → p2p-mqtt
  | "lan-whep"   // pin to LAN direct
  | "p2p-mqtt"   // pin to P2P MQTT
  | "off";       // no video

// DEC-107 Phase H: per-mode health state for the dropdown indicator. Updated
// in real time by the cascade hook as it tries each mode.
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
  | "other";

export interface TransportHealth {
  state: "unknown" | "testing" | "ok" | "failed";
  lastError: string | null;
  lastTriedAt: number | null;
  latencyMs: number | null;
  lastErrorCode: TransportErrorCode | null;
  lastAttemptStage: TransportAttemptStage | null;
}

const emptyHealth = (): TransportHealth => ({
  state: "unknown",
  lastError: null,
  lastTriedAt: null,
  latencyMs: null,
  lastErrorCode: null,
  lastAttemptStage: null,
});

interface VideoStoreState {
  streamUrl: string | null;
  isStreaming: boolean;
  isRecording: boolean;
  fps: number;
  latencyMs: number;
  resolution: string;

  // DEC-108 Phase D: extended WebRTC stats
  codec: string;            // e.g. "H264" or "VP8"
  bitrateKbps: number;      // derived from bytesReceived delta
  packetsLost: number;      // cumulative
  jitterMs: number;         // from inbound-rtp.jitter (sec * 1000)
  transport: VideoTransport;

  // DEC-108 Phase E: HMR-safe polling state. Module-level globals in
  // webrtc-client.ts get reset every time Turbopack reloads the module
  // (which happens on any unrelated file change in the dev server). The
  // FPS counter delta computation needs persistent state across polls.
  // Zustand stores live on globalThis and survive HMR cleanly.
  _pollState: {
    lastFrameTime: number;
    lastFramesDecoded: number;
    lastStatsTime: number;
    lastBytesReceived: number;
    lastJitterDelay: number;
    lastJitterEmitted: number;
  };
  setPollState: (s: Partial<VideoStoreState["_pollState"]>) => void;
  resetPollState: () => void;

  // DEC-107 Phase H: per-mode transport health. Keyed by VideoTransport.
  // Cascade hook and UX switcher both read/write this map.
  transportHealth: Record<VideoTransport, TransportHealth>;
  setTransportHealth: (t: VideoTransport, h: Partial<TransportHealth>) => void;
  resetTransportHealth: () => void;

  // Cloud video state
  cloudStreamUrl: string | null;
  cloudStreaming: boolean;

  // Agent video status (from /api/video polling)
  agentVideoState: string;
  agentWhepUrl: string | null;
  agentDependencies: Record<string, { found: boolean }> | null;

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

  _pollState: {
    lastFrameTime: 0,
    lastFramesDecoded: 0,
    lastStatsTime: 0,
    lastBytesReceived: 0,
    lastJitterDelay: 0,
    lastJitterEmitted: 0,
  },

  transportHealth: {
    "lan-whep": emptyHealth(),
    "p2p-mqtt": emptyHealth(),
    "cloud-whep": emptyHealth(),
    "cloud-mse": emptyHealth(),
    "off": emptyHealth(),
    "unknown": emptyHealth(),
  },

  cloudStreamUrl: null,
  cloudStreaming: false,

  agentVideoState: "unknown",
  agentWhepUrl: null,
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
  setCloudStreamUrl: (cloudStreamUrl) => set({ cloudStreamUrl }),
  setCloudStreaming: (cloudStreaming) => set({ cloudStreaming }),
  setAgentVideoStatus: (agentVideoState, agentWhepUrl, deps) =>
    set({ agentVideoState, agentWhepUrl, agentDependencies: deps ?? null }),
}));
