"use client";

/**
 * Resolves, for ONE named fleet node, whether this browser may publish
 * flight-controller frames to it — the per-node counterpart of
 * `useMqttControlAuthority`, which answers the same question only for whichever
 * drone is currently selected.
 *
 * A fleet surface renders many nodes at once, so it cannot read the selected
 * drone's authority and paint it on every row: twenty rows would show twenty
 * copies of one node's truth. This hook keys on the node instead.
 *
 * It answers from PROVEN facts and nothing else: the write grant this browser
 * has actually minted and holds the secret for, and what the open transport for
 * that node reports about publishing. A node with no open transport gets no
 * claim at all — the browser has not tried to reach it, so whether a command
 * would land is not yet a fact, and "receive only" on a node we never dialled
 * would be a fabricated reading exactly as much as a healthy dot would be
 * (Rule 44). What the surface must never do is show a node as fully commandable
 * when the transport it is actually carried on has already reported that it
 * cannot publish, and that is the case this closes.
 *
 * The grant comes from `mqtt-control-grant-store`, the same source
 * `useMqttControlAuthority` reads, so the selected-drone header and every fleet
 * row give one answer rather than two.
 *
 * @module hooks/use-node-control-authority
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { useDroneManager } from "@/stores/drone-manager";
import { useClockStore } from "@/stores/clock-store";
import { useMqttControlGrantStore } from "@/stores/mqtt-control-grant-store";
import { useClockTick } from "@/lib/agent/freshness";
import { deviceIdFromNodeId, nodeIdForDevice } from "@/lib/agent/node-id";
import type { StatusLevel } from "@/components/ui/status-dot";
import {
  needsOperatorAttention,
  resolveMqttControlAuthority,
  type ControlLane,
  type MqttControlAuthority,
} from "@/lib/nodes/mqtt-control-authority";

/**
 * Authority for the node with this `node:<deviceId>` id.
 *
 * @param nodeId - the managed-drone / fleet-entry id, or null to resolve
 *   nothing (an unreachable or not-yet-identified row).
 */
export function useNodeControlAuthority(
  nodeId: string | null | undefined,
): MqttControlAuthority {
  const transportType = useDroneManager((s) =>
    nodeId ? (s.drones.get(nodeId)?.transport.type ?? null) : null,
  );
  // The transport's own answer about whether it can publish, not an inference
  // from which lane it is. Only the transport knows which credential it holds.
  const transportCanCommand = useDroneManager((s) =>
    nodeId ? (s.drones.get(nodeId)?.transport.canCommand ?? false) : false,
  );

  // Ride the shared 1Hz clock rather than reading Date.now() during render, so
  // an expiring grant moves the indicator on its own.
  useClockTick();
  const now = useClockStore((s) => s.now);

  const lane: ControlLane =
    transportType === "mqtt-mavlink" ? "cloud-relay" : "direct";

  // The grant store is the single source every authority surface reads, so a
  // fleet row and the selected-drone header cannot disagree. It is ANDed with the
  // transport's own answer because the two can genuinely differ for a moment: a
  // grant minted before the relay reconnected is held and still unusable.
  const heldGrant = useMqttControlGrantStore((s) => s.grant);
  const minting = useMqttControlGrantStore((s) => s.minting);
  const grant = lane === "cloud-relay" && transportCanCommand ? heldGrant : null;

  return resolveMqttControlAuthority({
    lane,
    // The grant's scope is agent device ids; a fleet id is `node:<deviceId>`.
    deviceId: deviceIdFromNodeId(nodeId) ?? "",
    grant,
    minting,
    now,
  });
}

/** The same, for a surface that holds a bare agent device id. */
export function useDeviceControlAuthority(
  deviceId: string | null | undefined,
): MqttControlAuthority {
  return useNodeControlAuthority(deviceId ? nodeIdForDevice(deviceId) : null);
}

/**
 * What a surface should say about a node's command authority, or nothing at
 * all. One resolver for every surface so the sidebar row, the fleet tile, the
 * board row and the node header cannot describe the same state three ways.
 *
 * Deliberately separate from `nodeStatusLevel`, the shared health-ring
 * vocabulary: health answers "is this node alive", authority answers "can I
 * command it", and a node can be perfectly alive and uncommandable. Folding one
 * into the other would make both unreadable.
 */
export interface ControlAuthorityNotice {
  /** True when the operator must be told, unprompted. */
  readonly show: boolean;
  /** Short label for a chip or badge. */
  readonly label: string;
  /** The full sentence, for a title / tooltip / screen-reader companion. */
  readonly detail: string;
  /** Severity, for a dot or chip colour. */
  readonly level: StatusLevel;
}

/** Resolve the notice for an already-resolved authority. */
export function useControlAuthorityNotice(
  authority: MqttControlAuthority,
): ControlAuthorityNotice {
  const t = useTranslations("nodeConsole");
  const show = needsOperatorAttention(authority);
  if (authority.fcFrames === "provisioning") {
    return {
      show,
      label: t("authority.provisioningShort"),
      detail: t("authority.provisioning"),
      // Being obtained is not a fault, but it must never read as ready.
      level: "idle",
    };
  }
  if (authority.fcFrames === "expiring") {
    return {
      show,
      label: t("authority.expiringShort"),
      detail: t("authority.expiring"),
      level: "warning",
    };
  }
  return {
    show,
    label: t("authority.receiveOnlyShort"),
    detail: t("authority.receiveOnly"),
    level: "warning",
  };
}

/** Resolve the notice for a node by its `node:<deviceId>` id. */
export function useNodeControlAuthorityNotice(
  nodeId: string | null | undefined,
): ControlAuthorityNotice {
  return useControlAuthorityNotice(useNodeControlAuthority(nodeId));
}
