import { create } from "zustand";

// DEC-108 Phase D: detected transport for the active video stream.
// "lan-whep" = WHEP from a private/loopback URL (LAN direct, lowest latency)
// "cloud-whep" = WHEP from a public cloud relay hostname
// "cloud-mse" = MSE WebSocket fallback from the cloud video relay
// "unknown" = no stream OR transport not yet detected
// "p2p-mqtt" = Direct WebRTC peer connection, SDP signaling relayed via MQTT
//              (DEC-108 Phase B0). Works cross-network via STUN; media flows
//              direct P2P after the handshake.
export type VideoTransport = "lan-whep" | "cloud-whep" | "cloud-mse" | "p2p-mqtt" | "unknown";

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
  setCloudStreamUrl: (cloudStreamUrl) => set({ cloudStreamUrl }),
  setCloudStreaming: (cloudStreaming) => set({ cloudStreaming }),
  setAgentVideoStatus: (agentVideoState, agentWhepUrl, deps) =>
    set({ agentVideoState, agentWhepUrl, agentDependencies: deps ?? null }),
}));
