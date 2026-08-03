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
 * It answers from a PROVEN fact and nothing else: an open transport this
 * browser holds for that node, and what that transport itself reports about
 * publishing. A node with no open transport gets no claim at all — the browser
 * has not tried to reach it, so whether a command would land is not yet a fact,
 * and "receive only" on a node we never dialled would be a fabricated reading
 * exactly as much as a healthy dot would be (Rule 44). What the surface must
 * never do is show a node as fully commandable when the transport it is
 * actually carried on has already reported that it cannot publish, and that is
 * the case this closes.
 *
 * When per-operator write grants land, `useMqttControlAuthority` is where they
 * are supplied; this hook resolves through the same pure resolver, so both
 * become correct together.
 *
 * @module hooks/use-node-control-authority
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { useDroneManager } from "@/stores/drone-manager";
import { useClockStore } from "@/stores/clock-store";
import { useClockTick } from "@/lib/agent/freshness";
import { nodeIdForDevice } from "@/lib/agent/node-id";
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

  const grant =
    lane === "cloud-relay" && transportCanCommand
      ? {
          deviceIds: [nodeId ?? ""],
          expiresAt: Number.POSITIVE_INFINITY,
          writeConfirmed: false,
        }
      : null;

  return resolveMqttControlAuthority({
    lane,
    deviceId: nodeId ?? "",
    grant,
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
