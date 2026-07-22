"use client";

/**
 * @module command/nodes-view/RelayModeCell
 * @description The mesh role a ground station is running in, and the control
 * that changes it.
 *
 * Role is a ground-station concept — a drone or a workstation has none, and the
 * cell says so rather than inventing a default. The value shown is the role
 * carried on the node's own fleet entry, so it is the role that node reported,
 * not the focused node's.
 *
 * A role change is written straight to that node's own agent with that node's
 * own key. There is no equivalent on the relay queue, so a node reachable only
 * through the cloud shows the control disabled and says why rather than
 * offering a change that would be dropped.
 *
 * While a change is in flight the cell shows the switching state and does not
 * claim the new role: the role it displays afterwards is the one the agent
 * reported back, and a rejected change leaves the old role visible with the
 * agent's own message.
 *
 * @license GPL-3.0-only
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Share2, ChevronDown } from "lucide-react";

import type { FleetNodeEntry } from "@/hooks/use-fleet-nodes";
import { groundStationApiFromAgent } from "@/lib/api/ground-station-api";
import type { GroundStationRole } from "@/lib/api/ground-station/types";
import { resolveLocalAgentForDrone } from "@/lib/agent/resolve-agent";
import { useToast } from "@/components/ui/toast";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import type { NodeReachDescriptor } from "@/lib/nodes/node-reach";
import { Chip, NEUTRAL_CHIP, UnknownValue } from "./cell-primitives";

/** The mesh roles a ground station can hold. */
export const GROUND_STATION_ROLES: readonly GroundStationRole[] = [
  "direct",
  "relay",
  "receiver",
];

/** True when this node has a mesh role at all. */
export function hasRelayRole(node: FleetNodeEntry): boolean {
  return node.profile === "ground-station";
}

export function RelayModeCell({
  node,
  reach,
}: {
  node: FleetNodeEntry;
  reach: NodeReachDescriptor;
}) {
  const t = useTranslations("nodesView");
  const { toast } = useToast();
  const [switching, setSwitching] = useState(false);

  if (!hasRelayRole(node)) {
    return <UnknownValue title={t("relay.notApplicable")} />;
  }

  // The role API is the node's own agent over the LAN; the relay queue has no
  // command for it, so a cloud-only node cannot be switched from here.
  const lanAgent = resolveLocalAgentForDrone(node.deviceId);
  const canSwitch = reach.kind === "lan" && lanAgent !== null;
  const blockedReason = !canSwitch
    ? reach.blockedReason
      ? t(`blocked.${reach.blockedReason}`)
      : t("relay.lanOnly")
    : undefined;

  async function applyRole(role: GroundStationRole) {
    if (!lanAgent || switching) return;
    const api = groundStationApiFromAgent(lanAgent.agentUrl, lanAgent.apiKey);
    if (!api) return;
    setSwitching(true);
    try {
      const info = await api.setRole(role);
      // The authoritative role is the one the node's own sentinel reports back,
      // which during a transition is still the old one — so the toast says
      // "switching" rather than claiming a role the node has not taken yet.
      const settled = info.current === role;
      toast(
        settled
          ? t("relay.applied", { name: node.name, role: t(`relay.${role}`) })
          : t("relay.transitioning", { name: node.name, role: t(`relay.${role}`) }),
        settled ? "success" : "info",
      );
    } catch (error) {
      toast(
        t("relay.failed", {
          name: node.name,
          error: error instanceof Error ? error.message : String(error),
        }),
        "error",
      );
    } finally {
      setSwitching(false);
    }
  }

  const label = switching
    ? t("relay.switching")
    : node.role
      ? t(`relay.${node.role}`)
      : t("relay.unknown");

  const trigger = (
    <button
      type="button"
      disabled={!canSwitch || switching}
      title={blockedReason}
      aria-label={t("relay.change", { name: node.name })}
      className="flex items-center gap-1 rounded border border-transparent px-1 py-0.5 hover:border-border-default hover:bg-bg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-transparent disabled:hover:bg-transparent"
    >
      <Chip className={NEUTRAL_CHIP}>
        <Share2 size={10} />
        {label}
      </Chip>
      {canSwitch && <ChevronDown size={11} className="text-text-tertiary" />}
    </button>
  );

  if (!canSwitch) return trigger;

  return (
    <DropdownMenu
      align="left"
      trigger={trigger}
      items={GROUND_STATION_ROLES.map((role) => ({
        id: role,
        label: t(`relay.${role}`),
        disabled: switching || role === node.role,
      }))}
      onSelect={(role) => void applyRole(role as GroundStationRole)}
    />
  );
}
