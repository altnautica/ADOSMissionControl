/**
 * Distributed-RX REST actions: load relay/receiver state, open/close the
 * invite-pairing window, approve incoming relay invites, revoke relays, and
 * snapshot pending invites. Lifted out of `mesh-store.ts` to keep that
 * slice file under the file-size budget.
 *
 * @license GPL-3.0-only
 */

import { errorMessage } from "./error-handler";
import { INITIAL_DISTRIBUTED_RX } from "./initial-state";
import type { GroundStationState } from "./state";
import type { GroundStationApi } from "@/lib/api/ground-station-api";

type Setter = (
  partial:
    | Partial<GroundStationState>
    | ((s: GroundStationState) => Partial<GroundStationState>),
) => void;

type Getter = () => GroundStationState;

export async function loadDistributedRx(
  api: GroundStationApi,
  set: Setter,
  get: Getter,
): Promise<void> {
  const currentRole = get().role.info?.current ?? "direct";
  if (currentRole === "direct") {
    set({ distributedRx: { ...INITIAL_DISTRIBUTED_RX } });
    return;
  }
  set({
    distributedRx: { ...get().distributedRx, loading: true, error: null },
  });
  try {
    if (currentRole === "receiver") {
      const [relays, combined, pending] = await Promise.all([
        api.getWfbReceiverRelays(),
        api.getWfbReceiverCombined(),
        api.getPairingPending(),
      ]);
      set({
        distributedRx: {
          ...get().distributedRx,
          receiverRelays: relays.relays,
          combined,
          relayStatus: null,
          pairingWindowOpen: !!pending.open,
          pairingWindowExpiresAt: pending.closes_at_ms ?? null,
          pairingCode: pending.open ? (pending.code ?? null) : null,
          pendingRequests: pending.pending ?? [],
          loading: false,
          error: null,
        },
      });
    } else if (currentRole === "relay") {
      const relayStatus = await api.getWfbRelayStatus();
      set({
        distributedRx: {
          ...get().distributedRx,
          receiverRelays: [],
          combined: null,
          relayStatus,
          pairingWindowOpen: false,
          pairingWindowExpiresAt: null,
          pairingCode: null,
          pendingRequests: [],
          loading: false,
          error: null,
        },
      });
    }
  } catch (err) {
    const { message, status } = errorMessage(err);
    // Of the reads above only the pairing snapshot answers 503, when the
    // mesh pairing daemon is not reachable. The receiver routes never do, so
    // naming a receiver port here would send the operator to the wrong place.
    const friendly =
      status === 503
        ? "The mesh pairing service is not answering, so the Accept window and join requests cannot be read. Check that ados-mesh-pairing.service is running on this ground station."
        : message;
    set({
      distributedRx: {
        ...get().distributedRx,
        loading: false,
        error: friendly,
      },
    });
  }
}

export async function openPairingWindow(
  api: GroundStationApi,
  duration_s: number,
  set: Setter,
  get: Getter,
): Promise<boolean> {
  try {
    const window = await api.openPairingWindow(duration_s);
    set({
      distributedRx: {
        ...get().distributedRx,
        pairingWindowOpen: true,
        pairingWindowExpiresAt: window.closes_at_ms,
        pairingCode: window.code,
        error: null,
      },
    });
    return true;
  } catch (err) {
    const { message } = errorMessage(err);
    set({ distributedRx: { ...get().distributedRx, error: message } });
    return false;
  }
}

export async function closePairingWindow(
  api: GroundStationApi,
  set: Setter,
  get: Getter,
): Promise<boolean> {
  try {
    await api.closePairingWindow();
    set({
      distributedRx: {
        ...get().distributedRx,
        pairingWindowOpen: false,
        pairingWindowExpiresAt: null,
        pairingCode: null,
        pendingRequests: [],
        error: null,
      },
    });
    return true;
  } catch (err) {
    const { message } = errorMessage(err);
    set({ distributedRx: { ...get().distributedRx, error: message } });
    return false;
  }
}

export async function approvePairing(
  api: GroundStationApi,
  device_id: string,
  set: Setter,
  get: Getter,
): Promise<boolean> {
  try {
    await api.approvePairing(device_id);
    return true;
  } catch (err) {
    const { message } = errorMessage(err);
    set({ distributedRx: { ...get().distributedRx, error: message } });
    return false;
  }
}

export async function revokeRelay(
  api: GroundStationApi,
  device_id: string,
  set: Setter,
  get: Getter,
): Promise<boolean> {
  try {
    await api.revokeRelay(device_id);
    const current = get().distributedRx;
    set({
      distributedRx: {
        ...(current ?? {}),
        receiverRelays: (current?.receiverRelays ?? []).filter(
          (r) => r.mac !== device_id,
        ),
        error: null,
      },
    });
    return true;
  } catch (err) {
    const { message } = errorMessage(err);
    set({ distributedRx: { ...get().distributedRx, error: message } });
    return false;
  }
}

export async function loadPairingPending(
  api: GroundStationApi,
  set: Setter,
  get: Getter,
): Promise<void> {
  try {
    const snap = await api.getPairingPending();
    set({
      distributedRx: {
        ...get().distributedRx,
        pairingWindowOpen: !!snap.open,
        pairingWindowExpiresAt: snap.closes_at_ms ?? null,
        pairingCode: snap.open ? (snap.code ?? null) : null,
        pendingRequests: snap.pending ?? [],
        error: null,
      },
    });
  } catch (err) {
    const { message } = errorMessage(err);
    set({ distributedRx: { ...get().distributedRx, error: message } });
  }
}
