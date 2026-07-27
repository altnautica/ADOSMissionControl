/**
 * @module AgentConnectionLocalStateSlice
 * @description Local-mode connection state: agent REST URL, API key, polling
 * lifecycle bookkeeping, MAVLink WebSocket URL, and the staleness cascade
 * that flips the header to offline after sustained poll failures.
 * @license GPL-3.0-only
 */

import { useAgentSystemStore } from "../agent-system-store";
import type {
  LocalStateSlice,
  AgentConnectionSliceCreator,
  LocalState,
} from "./types";

export const localStateSlice: AgentConnectionSliceCreator<LocalStateSlice> = (
  set,
  get,
) => ({
  agentUrl: null,
  apiKey: null,
  connected: false,
  client: null,
  connectionError: null,
  pollInterval: null,
  consecutiveFailures: 0,
  mavlinkUrl: null,
  nodeDeviceId: null,
  stalePairing: null,
  controlRttMs: null,
  relay: false,

  setApiKey(key) {
    set({ apiKey: key });
  },

  setMavlinkUrl(url) {
    set({ mavlinkUrl: url });
  },

  setControlRttMs(rttMs) {
    set({ controlRttMs: rttMs });
  },

  noteFetchSuccess() {
    const { consecutiveFailures, connected, connectionError } = get();
    const patch: Partial<LocalState> = {};
    if (consecutiveFailures !== 0) patch.consecutiveFailures = 0;
    if (!connected) patch.connected = true;
    if (connectionError) patch.connectionError = null;
    if (Object.keys(patch).length > 0) set(patch);
    // Fetch succeeded; system store stale flag is cleared by the fetcher itself.
  },

  noteFetchFailure() {
    const next = get().consecutiveFailures + 1;
    set({ consecutiveFailures: next });
    // After 3 consecutive failures (~9s at 3s poll), mark data stale but keep
    // last-known values visible. After 6 (~18s), flip the header to offline.
    if (next >= 3) {
      if (!useAgentSystemStore.getState().stale) {
        useAgentSystemStore.setState({ stale: true });
      }
    }
    if (next >= 6) {
      if (get().connected) {
        set({
          connected: false,
          connectionError: "Lost connection to agent",
        });
      }
    }
  },
});
