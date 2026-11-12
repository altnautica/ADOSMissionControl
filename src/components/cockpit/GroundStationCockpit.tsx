"use client";

/**
 * @module cockpit/GroundStationCockpit
 * @description The Cockpit tab of a ground station. A ground station flies
 * nothing itself: its cockpit is the cockpit of the drone it carries over its
 * radio link. The telemetry, video and command stores follow the selected
 * node, so the carried drone's cockpit opens with that drone selected — its
 * own Cockpit tab, fed through this ground station — rather than drawing the
 * drone's name over the ground station's own (empty) readings.
 *
 * With no drone linked the tab says so and points at the Carried drones tab.
 * @license GPL-3.0-only
 */

import { specString } from "@/lib/cockpit/spec-strings";
import { Gamepad2, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCommandFleetStore } from "@/stores/command-fleet-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useDroneMetadataStore } from "@/stores/drone-metadata-store";
import { useUiStore } from "@/stores/ui-store";
import { extractLinkedPeers } from "@/lib/agent/relayed-peers";
import { nodeIdForDevice } from "@/lib/agent/node-id";
import { useNodeRegistryStore, type NodeEntry } from "@/stores/node-registry";
import { useNodePersonalizationStore } from "@/stores/node-personalization-store";

/**
 * The carried drone's operator-visible name: the operator's profile name, then
 * the operator's row label, then the name its agent reports through the node
 * registry. The raw device id is the last resort.
 */
export function carriedDroneName(
  deviceId: string,
  profileName: string | undefined,
  label: string | undefined,
  nodes: Record<string, NodeEntry>,
): string {
  const fromProfile = profileName?.trim();
  if (fromProfile) return fromProfile;
  const fromLabel = label?.trim();
  if (fromLabel) return fromLabel;
  for (const entry of Object.values(nodes)) {
    if (entry.presence.deviceId === deviceId && entry.presence.name.trim()) {
      return entry.presence.name.trim();
    }
  }
  return deviceId;
}

interface GroundStationCockpitProps {
  /** The ground station's agent device id, or null when it has none. */
  groundDeviceId: string | null;
}

export function GroundStationCockpit({ groundDeviceId }: GroundStationCockpitProps) {
  const peerDeviceId = useCommandFleetStore((s) =>
    groundDeviceId
      ? (extractLinkedPeers(s.cloudStatuses[groundDeviceId])[0]?.deviceId ?? null)
      : null,
  );
  const carriedNodeId = peerDeviceId ? nodeIdForDevice(peerDeviceId) : null;
  const carriedProfileName = useDroneMetadataStore((s) =>
    carriedNodeId ? s.profiles[carriedNodeId]?.displayName : undefined,
  );
  const carriedLabel = useNodePersonalizationStore((s) =>
    peerDeviceId ? s.byNode[peerDeviceId]?.label : undefined,
  );
  const registryNodes = useNodeRegistryStore((s) => s.nodes);

  if (!carriedNodeId || !peerDeviceId) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <Radio size={28} className="text-text-tertiary" aria-hidden="true" />
        <p className="text-sm font-medium text-text-primary">{specString("cockpit.no_carried.title")}</p>
        <p className="max-w-sm text-xs text-text-secondary">{specString("cockpit.no_carried.message")}</p>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => useUiStore.getState().setPendingDetailTab("carriedDrones")}
        >
          {specString("cockpit.carried.open")}
        </Button>
      </div>
    );
  }

  const name = carriedDroneName(peerDeviceId, carriedProfileName, carriedLabel, registryNodes);
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <Gamepad2 size={28} className="text-accent-primary" aria-hidden="true" />
      <p className="text-sm font-medium text-text-primary">{specString("cockpit.carried.title", { name })}</p>
      <p className="max-w-sm text-xs text-text-secondary">{specString("cockpit.carried.message")}</p>
      <Button
        variant="primary"
        size="sm"
        onClick={() => {
          useDroneManager.getState().selectDrone(carriedNodeId);
          useUiStore.getState().setPendingDetailTab("cockpit");
        }}
      >
        {specString("cockpit.carried.fly", { name })}
      </Button>
    </div>
  );
}
