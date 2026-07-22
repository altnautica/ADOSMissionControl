"use client";

/**
 * @module command/nodes-view/RelayModeCell
 * @description The mesh role a ground station is running in.
 *
 * Role is a ground-station concept — a drone or a workstation has none, and the
 * cell says "not applicable" rather than inventing a default. The value shown is
 * the role carried on the node's own fleet entry, so it is the role that node
 * reported, not the focused node's.
 *
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { Share2 } from "lucide-react";

import type { FleetNodeEntry } from "@/hooks/use-fleet-nodes";
import { Chip, NEUTRAL_CHIP, UnknownValue } from "./cell-primitives";

/** The mesh roles a ground station can hold. */
export const GROUND_STATION_ROLES = ["direct", "relay", "receiver"] as const;
export type GroundStationRoleId = (typeof GROUND_STATION_ROLES)[number];

/** True when this node has a mesh role at all. */
export function hasRelayRole(node: FleetNodeEntry): boolean {
  return node.profile === "ground-station";
}

export function RelayModeCell({ node }: { node: FleetNodeEntry }) {
  const t = useTranslations("nodesView");

  if (!hasRelayRole(node)) {
    return <UnknownValue title={t("relay.notApplicable")} />;
  }
  if (!node.role) {
    return <UnknownValue title={t("relay.noReading")} />;
  }

  return (
    <Chip className={NEUTRAL_CHIP}>
      <Share2 size={10} />
      {t(`relay.${node.role}`)}
    </Chip>
  );
}
