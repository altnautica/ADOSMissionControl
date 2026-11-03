/**
 * @module ekf-source-store
 * @description Per-drone EKF source-set state the GCS knows about: the set
 * this GCS last commanded with `setEkfSourceSet`, and the
 * `EK3_SRC{1,2,3}_{POSXY,VELXY,YAW}` values read once per protocol
 * connection. The nav-source chip reads both.
 *
 * @license GPL-3.0-only
 */

import { create } from "zustand";

export type EkfSourceSet = 1 | 2 | 3;

interface EkfSourceState {
  /** The set last commanded by this GCS, per drone. */
  lastCommanded: Record<string, EkfSourceSet>;
  /** EK3_SRC* values per drone; absent until read, never partially guessed. */
  params: Record<string, Readonly<Record<string, number>>>;
  setLastCommanded: (droneId: string, set: EkfSourceSet) => void;
  setParams: (droneId: string, params: Readonly<Record<string, number>>) => void;
  clear: (droneId: string) => void;
}

export const useEkfSourceStore = create<EkfSourceState>()((set) => ({
  lastCommanded: {},
  params: {},
  setLastCommanded: (droneId, value) =>
    set((s) => ({ lastCommanded: { ...s.lastCommanded, [droneId]: value } })),
  setParams: (droneId, params) => set((s) => ({ params: { ...s.params, [droneId]: params } })),
  clear: (droneId) =>
    set((s) => {
      if (!(droneId in s.lastCommanded) && !(droneId in s.params)) return s;
      const lastCommanded = { ...s.lastCommanded };
      const params = { ...s.params };
      delete lastCommanded[droneId];
      delete params[droneId];
      return { lastCommanded, params };
    }),
}));
