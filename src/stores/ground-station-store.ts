/**
 * Ground-station store aggregator. Combines five per-domain slices (link,
 * pair, uplink, mesh, peripherals) into the single Zustand store consumers
 * import as `useGroundStationStore`. Cross-slice reads and writes keep
 * working because every slice creator receives the full `set`/`get`.
 *
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import type { GroundStationState } from "./ground-station/state";
import { createLinkSlice } from "./ground-station/link-store";
import { createPairSlice } from "./ground-station/pair-store";
import { createUplinkSlice } from "./ground-station/uplink-store";
import { createMeshSlice } from "./ground-station/mesh-store";
import { createPeripheralsSlice } from "./ground-station/peripherals-store";
import { INITIAL_STORE_SLICE } from "./ground-station/initial-state";

export {
  errorMessage,
  roleSwitchErrorMessage,
} from "./ground-station/error-handler";
export type * from "./ground-station/types";
export {
  useLinkSlice,
  usePairSlice,
  useUplinkSlice,
  useMeshSlice,
  usePeripheralsSlice,
} from "./ground-station/hooks";

export const useGroundStationStore = create<GroundStationState>((set, get) => ({
  ...createLinkSlice(set, get),
  ...createPairSlice(set, get),
  ...createUplinkSlice(set, get),
  ...createMeshSlice(set, get),
  ...createPeripheralsSlice(set, get),

  resetAll: () => set({ ...INITIAL_STORE_SLICE }),
}));
