"use client";

/**
 * @module use-ekf-source-params
 * @description Reads `EK3_SRC{1,2,3}_{POSXY,VELXY,YAW}` once per protocol
 * connection through `DroneProtocol.getParameter` and caches them in
 * {@link useEkfSourceStore}. A parameter the firmware lacks fails silently;
 * when none can be read the result stays null ("parameters unknown") and the
 * nav-source chip derives the source from the EKF flags instead.
 *
 * @license GPL-3.0-only
 */

import { useEffect } from "react";

import type { DroneProtocol } from "@/lib/protocol/types";
import { useDroneManager } from "@/stores/drone-manager";
import { useEkfSourceStore } from "@/stores/ekf-source-store";

export const EKF_SOURCE_PARAM_NAMES: readonly string[] = [1, 2, 3].flatMap((n) => [
  `EK3_SRC${n}_POSXY`,
  `EK3_SRC${n}_VELXY`,
  `EK3_SRC${n}_YAW`,
]);

/**
 * Read every EK3_SRC* parameter, one at a time so a slow link never sees a
 * burst of requests. Returns the values that were read, or null when none
 * were (a firmware without EKF3 source sets).
 */
export async function readEkfSourceParams(
  protocol: Pick<DroneProtocol, "getParameter">,
): Promise<Record<string, number> | null> {
  const out: Record<string, number> = {};
  for (const name of EKF_SOURCE_PARAM_NAMES) {
    try {
      const p = await protocol.getParameter(name);
      if (Number.isFinite(p.value)) out[name] = Math.round(p.value);
    } catch {
      // Optional parameter: absent on this firmware.
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** One read per protocol instance, shared by every caller. */
const reads = new WeakMap<object, Promise<void>>();

/** EK3_SRC* values for a drone, or null while unknown. */
export function useEkfSourceParams(
  droneId: string | null | undefined,
): Readonly<Record<string, number>> | null {
  const protocol = useDroneManager((s) => (droneId ? s.drones.get(droneId)?.protocol ?? null : null));
  const connected = protocol?.isConnected === true;
  const params = useEkfSourceStore((s) => (droneId ? s.params[droneId] ?? null : null));

  useEffect(() => {
    if (!droneId || !protocol || !connected || reads.has(protocol)) return;
    // A new connection may be a different vehicle: forget the old values
    // (the last commanded set is kept; it names what this GCS sent).
    useEkfSourceStore.setState((s) => {
      if (!(droneId in s.params)) return s;
      const next = { ...s.params };
      delete next[droneId];
      return { params: next };
    });
    reads.set(
      protocol,
      readEkfSourceParams(protocol).then((values) => {
        if (values) useEkfSourceStore.getState().setParams(droneId, values);
      }),
    );
  }, [droneId, protocol, connected]);

  return params;
}
