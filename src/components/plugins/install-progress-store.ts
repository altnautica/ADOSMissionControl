"use client";

/**
 * @module install-progress-store
 * @description Shared Zustand store for in-flight plugin install jobs so
 * multiple surfaces (the install dialog, the per-drone Plugins tab, the
 * fleet overview) can observe the same progress state without each
 * opening its own WebSocket / Convex subscription.
 *
 * The actual subscription lives in `PluginInstallProgress`. This store is
 * a thin coordination layer: that component writes stage updates here on
 * every transition, and any other consumer reads via a selector.
 *
 * @license GPL-3.0-only
 */

import { create } from "zustand";

/** The six-stage state machine plus the two terminal stages. */
export type InstallStage =
  | "uploading"
  | "queued"
  | "commanded"
  | "downloading"
  | "verifying"
  | "installing"
  | "enabling"
  | "completed"
  | "failed";

/** Transport that produced the most recent update for a job. `relay` is
 * the ground-station-proxied path for a drone with no LAN or cloud
 * identity of its own — see `transports/relay-url.ts`. */
export type InstallTransport = "lan" | "cloud" | "relay";

export interface InstallJobError {
  code: string;
  message: string;
}

export interface InstallJobSnapshot {
  jobId: string;
  stage: InstallStage;
  transport: InstallTransport;
  updatedAt: number;
  installId?: string;
  error?: InstallJobError;
  pluginName?: string;
  pluginVersion?: string;
  deviceId?: string;
}

interface InstallProgressState {
  jobs: Record<string, InstallJobSnapshot>;
  upsert: (snap: InstallJobSnapshot) => void;
  remove: (jobId: string) => void;
  clear: () => void;
}

export const useInstallProgressStore = create<InstallProgressState>((set) => ({
  jobs: {},
  upsert: (snap) =>
    set((s) => ({ jobs: { ...s.jobs, [snap.jobId]: snap } })),
  remove: (jobId) =>
    set((s) => {
      const next = { ...s.jobs };
      delete next[jobId];
      return { jobs: next };
    }),
  clear: () => set({ jobs: {} }),
}));

/** Ordered list of every stage. UI renders one dot per entry. */
export const INSTALL_STAGES: ReadonlyArray<InstallStage> = [
  "uploading",
  "queued",
  "commanded",
  "downloading",
  "verifying",
  "installing",
  "enabling",
] as const;

/** Stages that the LAN path skips (no upload, no cloud queue). */
export const LAN_SKIPPED_STAGES: ReadonlySet<InstallStage> = new Set([
  "uploading",
  "queued",
  "commanded",
  "downloading",
]);

/** True once the job cannot progress further. */
export function isTerminalStage(stage: InstallStage): boolean {
  return stage === "completed" || stage === "failed";
}

/** Index of `stage` in the canonical order. Terminal stages map past the
 * end so a completed job lights every dot. */
export function stageIndex(stage: InstallStage): number {
  if (isTerminalStage(stage)) return INSTALL_STAGES.length;
  const idx = INSTALL_STAGES.indexOf(stage);
  return idx < 0 ? 0 : idx;
}

/** Human-readable label for the in-progress banner copy. */
export function humanStage(stage: InstallStage): string {
  switch (stage) {
    case "uploading": return "Uploading archive";
    case "queued": return "Queued for agent";
    case "commanded": return "Agent acknowledged";
    case "downloading": return "Agent downloading";
    case "verifying": return "Verifying signature";
    case "installing": return "Installing";
    case "enabling": return "Enabling";
    case "completed": return "Completed";
    case "failed": return "Failed";
  }
}
