/**
 * PIC arbiter REST + WebSocket actions. Lifted out of `peripherals-store.ts`
 * so the slice file stays under the file-size budget.
 *
 * @license GPL-3.0-only
 */

import { errorMessage } from "./error-handler";
import type { GroundStationState } from "./state";
import type { GroundStationApi, PicEvent } from "@/lib/api/ground-station-api";

type Setter = (
  partial:
    | Partial<GroundStationState>
    | ((s: GroundStationState) => Partial<GroundStationState>),
) => void;

type Getter = () => GroundStationState;

export async function loadPic(
  api: GroundStationApi,
  set: Setter,
  get: Getter,
): Promise<void> {
  set({ pic: { ...get().pic, loading: true, error: null } });
  try {
    const s = await api.getPicState();
    set({
      pic: {
        state: s.state,
        claimed_by: s.claimed_by,
        claim_counter: s.claim_counter,
        primary_gamepad_id: s.primary_gamepad_id,
        loading: false,
        error: null,
      },
    });
  } catch (err) {
    const { message } = errorMessage(err);
    set({ pic: { ...get().pic, loading: false, error: message } });
  }
}

export async function claimPic(
  api: GroundStationApi,
  clientId: string,
  opts: { confirmToken?: string; force?: boolean } | undefined,
  set: Setter,
  get: Getter,
): Promise<boolean> {
  set({ pic: { ...get().pic, loading: true, error: null } });
  try {
    const res = await api.claimPic(clientId, opts?.confirmToken, opts?.force);
    set({
      pic: {
        ...get().pic,
        loading: false,
        claimed_by: res.claimed_by,
        claim_counter: res.claim_counter,
        state: res.claimed ? "claimed" : get().pic.state,
        error: null,
      },
    });
    return res.claimed;
  } catch (err) {
    const { message } = errorMessage(err);
    set({ pic: { ...get().pic, loading: false, error: message } });
    return false;
  }
}

export async function releasePic(
  api: GroundStationApi,
  clientId: string,
  set: Setter,
  get: Getter,
): Promise<boolean> {
  set({ pic: { ...get().pic, loading: true, error: null } });
  try {
    const res = await api.releasePic(clientId);
    set({
      pic: {
        ...get().pic,
        loading: false,
        claimed_by: res.claimed_by,
        state: res.released ? "idle" : get().pic.state,
        error: null,
      },
    });
    return res.released;
  } catch (err) {
    const { message } = errorMessage(err);
    set({ pic: { ...get().pic, loading: false, error: message } });
    return false;
  }
}

export function pollPicHeartbeat(
  api: GroundStationApi,
  clientId: string,
  set: Setter,
  get: Getter,
): () => void {
  let stopped = false;
  // One heartbeat in flight at a time. The interval is 10 s and the request
  // now carries a 15 s deadline, so without this a slow uplink overlaps
  // ticks and the outstanding requests accumulate — which is how six
  // stalled heartbeats used to exhaust Chromium's 6-socket HTTP/1.1 pool
  // for the origin and queue every other ground-station call behind them.
  let inFlight = false;
  const tick = async () => {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      const res = await api.heartbeatPic(clientId);
      if (!res.ok && res.orphaned) {
        const current = get().pic;
        set({
          pic: {
            ...current,
            state: "idle",
            claimed_by: null,
            error: null,
          },
        });
      }
    } catch {
      // Network glitches are expected during uplink failover. Swallow
      // and let the next tick try again.
    } finally {
      inFlight = false;
    }
  };
  void tick();
  const handle = setInterval(tick, 10_000);
  return () => {
    stopped = true;
    clearInterval(handle);
  };
}

/** Fold one `/ws/pic` frame into the PIC slice. A claim makes `client_id` the
 * holder; a release or a holder disconnect leaves PIC unclaimed; an error
 * frame surfaces the arbiter being unreachable. */
export function applyPicEvent(
  current: GroundStationState["pic"],
  event: PicEvent,
): GroundStationState["pic"] {
  switch (event.event) {
    case "claimed":
      return {
        ...current,
        state: "claimed",
        claimed_by: event.client_id,
        claim_counter: event.claim_counter,
        error: null,
      };
    case "released":
    case "disconnected":
      return {
        ...current,
        state: "unclaimed",
        claimed_by: null,
        claim_counter: event.claim_counter,
        error: null,
      };
    case "error":
      return { ...current, error: event.message || event.code };
  }
}

export function subscribePicWs(
  api: GroundStationApi,
  set: Setter,
  get: Getter,
): () => void {
  return api.subscribePicEvents((event: PicEvent) => {
    const current = get().pic;
    const next = applyPicEvent(current, event);
    if (next !== current) set({ pic: next });
  });
}
