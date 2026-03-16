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

  setStreamUrl: (url: string | null) => void;
  setStreaming: (isStreaming: boolean) => void;
  setRecording: (isRecording: boolean) => void;
  updateStats: (fps: number, latencyMs: number) => void;
  setResolution: (resolution: string) => void;
  setCloudStreamUrl: (url: string | null) => void;
  setCloudStreaming: (streaming: boolean) => void;
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

  setStreamUrl: (streamUrl) => set({ streamUrl }),
  setStreaming: (isStreaming) => set({ isStreaming }),
  setRecording: (isRecording) => set({ isRecording }),
  updateStats: (fps, latencyMs) => set({ fps, latencyMs }),
  setResolution: (resolution) => set({ resolution }),
  setCloudStreamUrl: (cloudStreamUrl) => set({ cloudStreamUrl }),
  setCloudStreaming: (cloudStreaming) => set({ cloudStreaming }),
}));
