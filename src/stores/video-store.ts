import { create } from "zustand";

interface VideoStoreState {
  streamUrl: string | null;
  isStreaming: boolean;
  isRecording: boolean;
  fps: number;
  latencyMs: number;
  resolution: string;

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
  setCloudStreamUrl: (cloudStreamUrl) => set({ cloudStreamUrl }),
  setCloudStreaming: (cloudStreaming) => set({ cloudStreaming }),
  setAgentVideoStatus: (agentVideoState, agentWhepUrl, deps) =>
    set({ agentVideoState, agentWhepUrl, agentDependencies: deps ?? null }),
}));
