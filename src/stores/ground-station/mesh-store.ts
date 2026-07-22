/**
 * Mesh slice for the ground-station store. Owns ground-node role
 * (direct / relay / receiver), batman-adv mesh state (neighbors, routes,
 * gateways), gateway pinning, the distributed-RX combined-stream view, the
 * pairing window for invite acceptance, and the mesh WebSocket bridge that
 * surfaces role changes, neighbor churn, and partition events.
 *
 * @license GPL-3.0-only
 */

import type { GroundStationSliceCreator } from "./state";
import { errorMessage, roleSwitchErrorMessage } from "./error-handler";
import { INITIAL_DISTRIBUTED_RX, INITIAL_MESH, INITIAL_ROLE } from "./initial-state";
import { subscribeMeshWs } from "./mesh-ws";
import {
  approvePairing,
  closePairingWindow,
  loadDistributedRx,
  loadPairingPending,
  openPairingWindow,
  revokeRelay,
} from "./distributed-rx-actions";
import type {
  DistributedRxSlice as DistributedRxSliceShape,
  MeshSlice as MeshSliceShape,
  RoleSlice as RoleSliceShape,
} from "./types";
import type {
  GroundStationApi,
  GroundStationRole,
  MeshGatewayPreferenceUpdate,
  RoleInfo,
} from "@/lib/api/ground-station-api";

export interface MeshSlice {
  role: RoleSliceShape;
  distributedRx: DistributedRxSliceShape;
  mesh: MeshSliceShape;

  loadRole: (api: GroundStationApi) => Promise<void>;
  applyRole: (
    api: GroundStationApi,
    role: GroundStationRole,
  ) => Promise<RoleInfo | null>;
  loadDistributedRx: (api: GroundStationApi) => Promise<void>;
  loadMesh: (api: GroundStationApi) => Promise<void>;
  pinMeshGateway: (
    api: GroundStationApi,
    update: MeshGatewayPreferenceUpdate,
  ) => Promise<boolean>;
  openPairingWindow: (
    api: GroundStationApi,
    duration_s?: number,
  ) => Promise<boolean>;
  closePairingWindow: (api: GroundStationApi) => Promise<boolean>;
  approvePairing: (api: GroundStationApi, device_id: string) => Promise<boolean>;
  revokeRelay: (api: GroundStationApi, device_id: string) => Promise<boolean>;
  loadPairingPending: (api: GroundStationApi) => Promise<void>;
  subscribeMeshWs: (api: GroundStationApi) => () => void;
}

export const createMeshSlice: GroundStationSliceCreator<MeshSlice> = (
  set,
  get,
) => ({
  role: INITIAL_ROLE,
  distributedRx: INITIAL_DISTRIBUTED_RX,
  mesh: INITIAL_MESH,

  loadRole: async (api) => {
    set({ role: { ...get().role, loading: true, error: null } });
    try {
      const info = await api.getRole();
      set({ role: { info, loading: false, switching: false, error: null } });
    } catch (err) {
      const { message, status } = errorMessage(err);
      const friendly =
        status === 404
          ? "This agent is not in ground-station profile. Reinstall with install.sh --with-mesh or set agent.profile = ground-station in /etc/ados/config.yaml."
          : message;
      set({ role: { ...get().role, loading: false, error: friendly } });
    }
  },

  applyRole: async (api, role) => {
    set({ role: { ...get().role, switching: true, error: null } });
    try {
      const info = await api.setRole(role);
      set({ role: { info, loading: false, switching: false, error: null } });
      return info;
    } catch (err) {
      const friendly = roleSwitchErrorMessage(err, role);
      set({ role: { ...get().role, switching: false, error: friendly } });
      return null;
    }
  },

  loadDistributedRx: (api) => loadDistributedRx(api, set, get),

  loadMesh: async (api) => {
    const currentRole = get().role.info?.current ?? "direct";
    if (currentRole === "direct") {
      set({ mesh: { ...INITIAL_MESH } });
      return;
    }
    set({ mesh: { ...get().mesh, loading: true, error: null } });
    try {
      const [health, neighbors, routes, gateways] = await Promise.all([
        api.getMeshHealth(),
        api.getMeshNeighbors(),
        api.getMeshRoutes(),
        api.getMeshGateways(),
      ]);
      set({
        mesh: {
          ...get().mesh,
          health,
          neighbors: neighbors.neighbors,
          routes: routes.routes,
          gateways: gateways.gateways,
          selectedGateway: gateways.selected,
          loading: false,
          error: null,
        },
      });
    } catch (err) {
      const { message } = errorMessage(err);
      set({ mesh: { ...get().mesh, loading: false, error: message } });
    }
  },

  pinMeshGateway: async (api, update) => {
    try {
      await api.setMeshGatewayPreference(update);
      return true;
    } catch (err) {
      const { message } = errorMessage(err);
      set({ mesh: { ...get().mesh, error: message } });
      return false;
    }
  },

  openPairingWindow: (api, duration_s = 60) =>
    openPairingWindow(api, duration_s, set, get),

  closePairingWindow: (api) => closePairingWindow(api, set, get),

  approvePairing: (api, device_id) => approvePairing(api, device_id, set, get),

  revokeRelay: (api, device_id) => revokeRelay(api, device_id, set, get),

  loadPairingPending: (api) => loadPairingPending(api, set, get),

  subscribeMeshWs: (api) => subscribeMeshWs(api, set, get),
});
