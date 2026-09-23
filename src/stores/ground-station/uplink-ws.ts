/**
 * Uplink WebSocket event handler plus the data-cap projection shared with the
 * REST modem reads. Lifted out of `uplink-store.ts` so the slice file stays
 * focused on REST actions.
 *
 * `/ws/uplink` emits one frame shape, `{kind:"health_changed", active_uplink,
 * available, internet_reachable, data_cap_state, timestamp_ms}`, whenever the
 * uplink snapshot changes. Health, the active uplink, the failover log and the
 * data-cap state are all derived from it.
 *
 * @license GPL-3.0-only
 */

import { FAILOVER_LOG_CAP } from "./initial-state";
import type { GroundStationState } from "./state";
import type { UplinkDataCap, UplinkSlice } from "./types";
import type {
  DataCapState,
  GroundStationApi,
  ModemView,
  UplinkEvent,
  UplinkHealth,
} from "@/lib/api/ground-station-api";

const DATA_CAP_STATES: readonly DataCapState[] = ["ok", "warn_80", "throttle_95", "blocked_100"];

/** The data-cap tracker's state for a usage percentage: the state names are
 * the thresholds (80 % warn, 95 % throttle, 100 % blocked). */
function dataCapStateFor(percent: number): DataCapState {
  if (percent >= 100) return "blocked_100";
  if (percent >= 95) return "throttle_95";
  if (percent >= 80) return "warn_80";
  return "ok";
}

/** The uplink data-cap block from a modem view, or null when the view carries
 * no usage reading (no cap configured, or the tracker has not reported). */
export function dataCapFromModem(view: ModemView | null | undefined): UplinkDataCap | null {
  if (!view || view.cap_mb === null || view.data_used_mb === null || view.percent === null) {
    return null;
  }
  return {
    state: dataCapStateFor(view.percent),
    percent: view.percent,
    used_mb: view.data_used_mb,
    cap_mb: view.cap_mb,
  };
}

/** Fold one uplink frame into the slice. Returns null for a frame that is not
 * the uplink health frame. */
export function applyUplinkEvent(
  current: UplinkSlice,
  raw: unknown,
  now: number,
): UplinkSlice | null {
  const e = raw as Partial<UplinkEvent> | null;
  if (!e || e.kind !== "health_changed") return null;
  const active = typeof e.active_uplink === "string" ? e.active_uplink : null;
  const reachable = e.internet_reachable === true;
  const health: UplinkHealth = reachable ? "ok" : active !== null ? "degraded" : "down";

  let failoverLog = current.failover_log;
  if (current.active !== null && active !== null && active !== current.active) {
    const entry = {
      from: current.active,
      to: active,
      reason: reachable ? "active uplink changed" : "active uplink changed, no internet",
      timestamp: typeof e.timestamp_ms === "number" ? e.timestamp_ms : now,
    };
    failoverLog = [entry, ...current.failover_log].slice(0, FAILOVER_LOG_CAP);
  }

  const capState =
    typeof e.data_cap_state === "string" && DATA_CAP_STATES.includes(e.data_cap_state)
      ? e.data_cap_state
      : null;
  const dataCap =
    capState !== null && current.data_cap !== null
      ? { ...current.data_cap, state: capState }
      : current.data_cap;

  return {
    ...current,
    active,
    health,
    failover_log: failoverLog,
    data_cap: dataCap,
    fetchedAt: now,
  };
}

export function subscribeUplinkWs(
  api: GroundStationApi,
  set: (
    partial:
      | Partial<GroundStationState>
      | ((s: GroundStationState) => Partial<GroundStationState>),
  ) => void,
  get: () => GroundStationState,
): () => void {
  return api.subscribeUplinkEvents((event: UplinkEvent) => {
    const next = applyUplinkEvent(get().uplink, event, Date.now());
    if (next) set({ uplink: next });
  });
}
