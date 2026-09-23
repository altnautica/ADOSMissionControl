/**
 * Keeps a connected MAVLink session signing with the drone's stored key.
 *
 * The keystore and the signing store change when the operator enrolls,
 * rotates, imports, settles or removes a key. Each change re-reads the
 * drone's signer and hands it to the adapter, so the frames on the wire
 * always match what the signing surfaces report.
 *
 * @module protocol/signing-binding
 * @license GPL-3.0-only
 */

import type { DroneProtocol } from "./types";
import type { MavlinkSigner } from "./mavlink-signer";
import { MAVLinkAdapter } from "./mavlink-adapter";
import { getSigner, loadTimestamp, saveTimestamp } from "./signing-keystore";
import { useSigningStore } from "@/stores/signing-store";

/**
 * Apply `droneId`'s signer to `protocol` now and after every signing-state
 * change. Returns the unbind function, which persists the timestamp counter
 * and stops signing.
 */
export function bindSigning(droneId: string, protocol: DroneProtocol): () => void {
  if (!(protocol instanceof MAVLinkAdapter)) return () => {};

  let active = true;
  let generation = 0;
  let current: MavlinkSigner | null = null;

  const persistCounter = (signer: MavlinkSigner) => {
    saveTimestamp(droneId, signer.linkId, signer.currentTimestamp()).catch(() => {
      // Losing the persisted counter only costs a re-seed from the clock.
    });
  };

  const apply = async () => {
    const gen = ++generation;
    let next: MavlinkSigner | null;
    try {
      next = await getSigner(droneId);
      if (next && !(current && current.keyId === next.keyId && current.linkId === next.linkId)) {
        next.seedTimestamp(await loadTimestamp(droneId, next.linkId));
      }
    } catch {
      // Never includes key material: only the drone the read was for.
      console.warn(`[signing] could not read the signing key for ${droneId}`);
      next = null;
    }
    if (!active || gen !== generation) return;
    // The same key keeps its signer so the timestamp counter carries on.
    if (next && current && current.keyId === next.keyId && current.linkId === next.linkId) return;
    if (current) persistCounter(current);
    current = next;
    protocol.setSigner(next);
  };

  void apply();
  const unsubscribe = useSigningStore.subscribe((state, prev) => {
    if (state.drones[droneId] !== prev.drones[droneId]) void apply();
  });

  return () => {
    active = false;
    unsubscribe();
    if (current) persistCounter(current);
    current = null;
    protocol.setSigner(null);
  };
}
