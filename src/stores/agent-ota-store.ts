"use client";

/**
 * @module agent-ota-store
 * @description Live agent OTA self-update state for the System tab's Software
 * Update card. Polls the locally-paired agent's `GET /api/ota` (phase + download
 * fraction) and drives check / install / restart. Local-first: the OTA routes
 * ride the direct client only (the config proxy does not forward them), so the
 * card stays hidden whenever no client path exists — which includes cloud mode,
 * where the client is detached. The card gates on `available` (set true once
 * the agent answers `/api/ota`, false on a fetch error), so no agent-side
 * capability plumbing is required.
 * @license GPL-3.0-only
 */

import { create } from "zustand";

import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { hasClientPath } from "@/lib/agent/config-access";

/** Agent UpdateState values that represent an in-flight update. */
export const OTA_ACTIVE_STATES = [
  "downloading",
  "verifying",
  "installing",
  "restarting",
] as const;

export interface AgentOtaState {
  /** null = unknown/loading, false = endpoint absent/errored, true = present. */
  available: boolean | null;
  /** Agent UpdateState string (idle / checking / downloading / …). */
  state: string | null;
  currentVersion: string;
  pendingVersion: string | null;
  downloadPercent: number;
  downloadSpeedBps: number;
  /** A check/install action is in flight (button guard). */
  busy: boolean;
  error: string | null;
  lastUpdatedAt: number | null;
}

export interface AgentOtaActions {
  /** Poll GET /api/ota and fold it into the store. */
  refresh: () => Promise<void>;
  /** POST /api/ota/check, then refresh. */
  check: () => Promise<void>;
  /** POST /api/ota/install (blocks server-side; the poll shows progress), then restart. */
  install: () => Promise<void>;
  reset: () => void;
}

const INITIAL: AgentOtaState = {
  available: null,
  state: null,
  currentVersion: "",
  pendingVersion: null,
  downloadPercent: 0,
  downloadSpeedBps: 0,
  busy: false,
  error: null,
  lastUpdatedAt: null,
};

export const useAgentOtaStore = create<AgentOtaState & AgentOtaActions>()(
  (set, get) => ({
    ...INITIAL,

    async refresh() {
      const { client } = useAgentConnectionStore.getState();
      // Local-first: no client path (cloud / disconnected) → leave `available`
      // as-is so a null state keeps the card hidden without flicker.
      if (!hasClientPath(client)) return;
      try {
        const s = await client.getOtaStatus();
        set({
          available: true,
          state: s.state ?? null,
          currentVersion: s.current_version ?? "",
          pendingVersion: s.pending_update?.version ?? null,
          downloadPercent: Math.round(s.download?.percent ?? 0),
          downloadSpeedBps: s.download?.speed_bps ?? 0,
          lastUpdatedAt: Date.now(),
        });
      } catch {
        set({ available: false });
      }
    },

    async check() {
      const { client } = useAgentConnectionStore.getState();
      if (!hasClientPath(client)) return;
      set({ busy: true, error: null });
      try {
        await client.checkOtaUpdate();
      } catch (e) {
        set({ error: e instanceof Error ? e.message : String(e) });
      }
      set({ busy: false });
      await get().refresh();
    },

    async install() {
      const { client } = useAgentConnectionStore.getState();
      if (!hasClientPath(client)) return;
      set({ busy: true, error: null });
      try {
        // Blocks until the agent finishes; the card's poll loop renders the
        // phase + download bar meanwhile (the agent event loop stays free).
        await client.installOtaUpdate();
        await client.restartAfterOta().catch(() => {});
      } catch (e) {
        set({ error: e instanceof Error ? e.message : String(e) });
      }
      set({ busy: false });
      await get().refresh().catch(() => {});
    },

    reset() {
      set({ ...INITIAL });
    },
  }),
);
