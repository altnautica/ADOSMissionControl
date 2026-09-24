/**
 * @module AgentConnection
 * @description Aggregator for the agent connection store. Combines the local
 * polling slice, the cloud-mode slice, and the client lifecycle slice into
 * the single Zustand store consumers import as `useAgentConnectionStore`.
 * Cross-slice reads and writes keep working because every slice creator
 * receives the full `set` and `get`.
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import { localStateSlice } from "./local-state";
import { cloudStateSlice } from "./cloud-state";
import { clientManagerSlice } from "./client-manager";
import type { AgentConnectionStore } from "./types";
import { bindAgentConnectionLink } from "./link";

export type {
  AgentConnectionStore,
  LocalState,
  LocalActions,
  LocalStateSlice,
  CloudState,
  CloudActions,
  CloudStateSlice,
  ClientManagerActions,
  ClientManagerSlice,
  StalePairingInfo,
  StalePairingReason,
} from "./types";

export const useAgentConnectionStore = create<AgentConnectionStore>()((...a) => ({
  ...localStateSlice(...a),
  ...cloudStateSlice(...a),
  ...clientManagerSlice(...a),
}));

bindAgentConnectionLink(() => useAgentConnectionStore.getState());
