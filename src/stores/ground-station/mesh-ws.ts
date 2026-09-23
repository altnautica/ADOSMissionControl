/**
 * Mesh WebSocket event handler. Lifted out of `mesh-store.ts` so the slice
 * file stays focused on REST actions.
 *
 * @license GPL-3.0-only
 */

import type { GroundStationState } from "./state";
import type {
  GroundStationApi,
  GroundStationRole,
  MeshEvent,
} from "@/lib/api/ground-station-api";

export function subscribeMeshWs(
  api: GroundStationApi,
  set: (
    partial:
      | Partial<GroundStationState>
      | ((s: GroundStationState) => Partial<GroundStationState>),
  ) => void,
  get: () => GroundStationState,
): () => void {
  // Coalesce neighbor churn into a single `loadMesh` call per
  // 500 ms window so a storm of `neighbor_join` / `neighbor_leave`
  // events during mesh convergence does not stampede the agent REST
  // surface.
  let meshPollTimer: ReturnType<typeof setTimeout> | null = null;
  const NEIGHBOR_DEBOUNCE_MS = 500;
  const scheduleNeighborPoll = () => {
    if (meshPollTimer) return;
    meshPollTimer = setTimeout(() => {
      meshPollTimer = null;
      void get().loadMesh(api);
    }, NEIGHBOR_DEBOUNCE_MS);
  };

  return api.subscribeMeshEvents(
    (evt: MeshEvent) => {
      const state = get();
      if (evt.bus === "mesh") {
        if (evt.kind === "role_changed") {
          const info = state.role.info;
          if (info) {
            const nextRole = (evt.payload.role as GroundStationRole) ?? info.current;
            set({
              role: { ...state.role, info: { ...info, current: nextRole } },
            });
          }
        } else if (evt.kind === "neighbor_join" || evt.kind === "neighbor_leave") {
          scheduleNeighborPoll();
        } else if (evt.kind === "gateway_changed") {
          set({
            mesh: {
              ...state.mesh,
              selectedGateway: (evt.payload.selected as string | null) ?? null,
            },
          });
        } else if (evt.kind === "partition_detected") {
          if (state.mesh.health) {
            set({
              mesh: { ...state.mesh, health: { ...state.mesh.health, partition: true } },
            });
          }
        } else if (evt.kind === "partition_healed") {
          if (state.mesh.health) {
            set({
              mesh: { ...state.mesh, health: { ...state.mesh.health, partition: false } },
            });
          }
        } else if (
          evt.kind === "receiver_unreachable"
          || evt.kind === "relay_disconnected"
        ) {
          set({
            mesh: {
              ...state.mesh,
              lastTransientEvent: {
                kind: evt.kind,
                payload: evt.payload,
                ts: evt.timestamp_ms || Date.now(),
              },
            },
          });
        }
      } else if (evt.bus === "pair") {
        if (evt.kind === "accept_window_opened") {
          set({
            distributedRx: {
              ...state.distributedRx,
              pairingWindowOpen: true,
            },
          });
        } else if (evt.kind === "accept_window_closed") {
          set({
            distributedRx: {
              ...state.distributedRx,
              pairingWindowOpen: false,
              pairingWindowExpiresAt: null,
              pairingCode: null,
              pendingRequests: [],
            },
          });
        } else if (evt.kind === "revoked") {
          set({
            mesh: {
              ...state.mesh,
              lastTransientEvent: {
                kind: "relay_revoked",
                payload: evt.payload,
                ts: evt.timestamp_ms || Date.now(),
              },
            },
          });
        }
      }
    },
    (wsState: "connected" | "reconnecting" | "closed") => {
      const prev = get().mesh;
      set({
        mesh: {
          ...prev,
          wsState,
          wsDisconnectedAt:
            wsState === "connected"
              ? null
              : prev.wsState === "connected"
                ? Date.now()
                : prev.wsDisconnectedAt,
        },
      });
      if (wsState === "closed" && meshPollTimer) {
        clearTimeout(meshPollTimer);
        meshPollTimer = null;
      }
    },
  );
}
