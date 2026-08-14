"use client";

/**
 * Resolves, for the selected drone, whether this browser may actually publish
 * flight-controller frames over the cloud relay's broker.
 *
 * The transport type is the lane signal: a drone carried by `mqtt-mavlink` has
 * its FC frames routed through the broker and is therefore subject to the
 * broker's write policy; every other transport reaches the vehicle directly and
 * is not.
 *
 * @module hooks/use-mqtt-control-authority
 * @license GPL-3.0-only
 */

import { useDroneManager } from "@/stores/drone-manager";
import { useClockStore } from "@/stores/clock-store";
import { useMqttControlGrantStore } from "@/stores/mqtt-control-grant-store";
import { useClockTick } from "@/lib/agent/freshness";
import { deviceIdFromNodeId } from "@/lib/agent/node-id";
import {
  resolveMqttControlAuthority,
  type ControlLane,
  type MqttControlAuthority,
} from "@/lib/nodes/mqtt-control-authority";

/**
 * Authority for the currently selected drone.
 *
 * The grant comes from the grant store, which mints it, holds its secret, and
 * renews it — the same source every fleet row reads, so the selected-drone
 * surface and the board cannot disagree about whether this operator can command.
 */
export function useMqttControlAuthority(): MqttControlAuthority {
  const transportType = useDroneManager((s) => {
    const id = s.selectedDroneId;
    return id ? (s.drones.get(id)?.transport.type ?? null) : null;
  });
  // The transport's own answer, not an inference from which lane it is. A relay
  // transport holding a write grant is commandable and one without is not, and
  // only the transport knows which it holds.
  const transportCanCommand = useDroneManager((s) => {
    const id = s.selectedDroneId;
    return id ? (s.drones.get(id)?.transport.canCommand ?? false) : false;
  });
  const selectedDroneId = useDroneManager((s) => s.selectedDroneId);

  // Ride the shared 1Hz clock rather than reading Date.now() during render.
  // Two reasons, both load-bearing: reading the clock in render is impure, and
  // a value sampled once would leave the surface asserting authority that has
  // since lapsed until something unrelated happened to re-render it. Expiry has
  // to move the indicator on its own.
  useClockTick();
  const now = useClockStore((s) => s.now);

  const lane: ControlLane =
    transportType === "mqtt-mavlink" ? "cloud-relay" : "direct";

  // Two facts, and both are needed. The store knows which devices the grant
  // covers, when it lapses, and whether a write under it has ever been accepted;
  // the transport knows whether the session it actually dialled is carrying that
  // grant. A grant minted a moment ago that the relay has not reconnected with
  // yet still cannot publish, so claiming otherwise would recreate exactly the
  // silent-failure this module exists to prevent.
  const heldGrant = useMqttControlGrantStore((s) => s.grant);
  const minting = useMqttControlGrantStore((s) => s.minting);
  const grant = lane === "cloud-relay" && transportCanCommand ? heldGrant : null;

  return resolveMqttControlAuthority({
    lane,
    // The grant's scope is agent device ids; a selection id is `node:<deviceId>`.
    deviceId: deviceIdFromNodeId(selectedDroneId) ?? "",
    grant,
    minting,
    now,
  });
}
