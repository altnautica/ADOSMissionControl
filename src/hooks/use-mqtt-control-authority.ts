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
import { useClockTick } from "@/lib/agent/freshness";
import {
  resolveMqttControlAuthority,
  type ControlLane,
  type MqttControlAuthority,
} from "@/lib/nodes/mqtt-control-authority";

/**
 * Authority for the currently selected drone.
 *
 * The grant is `null` here because no credential is minted yet: the browser's
 * only broker credential is the shared read-only one, which cannot publish. So
 * on the relay lane this resolves to `no-grant`, which is the honest and
 * currently correct answer — the relay session can receive telemetry and cannot
 * command. When per-operator write grants land, this is the single place that
 * supplies one, and every surface reading this hook becomes correct at once.
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

  // A relay transport that reports it can publish is holding a write grant, so
  // the resolver is told about one. Synthesised from the transport rather than
  // fetched, because the transport is what the broker actually accepted and no
  // grant store is wired yet; the expiry is deliberately absent-equivalent
  // (far future) so this never claims a lifetime it cannot know.
  const grant =
    lane === "cloud-relay" && transportCanCommand
      ? {
          deviceIds: [selectedDroneId ?? ""],
          expiresAt: Number.POSITIVE_INFINITY,
          writeConfirmed: false,
        }
      : null;

  return resolveMqttControlAuthority({
    lane,
    deviceId: selectedDroneId ?? "",
    grant,
    now,
  });
}
