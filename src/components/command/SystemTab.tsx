"use client";

/**
 * @module SystemTab
 * @description Unified system view composing Hardware, Services, and Fleet
 * Network sub-panels. Profile-aware: a drone or ground-station node renders the
 * full FC / radio / regulatory / mesh panel set, while a workstation (headless
 * compute box) drops those nonsensical panels and surfaces compute / GPU and
 * cluster metrics instead.
 * @license GPL-3.0-only
 */

import { useSurfaceGate } from "@/hooks/use-surface-gate";
import { agentGateFallback } from "./shared/agent-gate-fallback";
import { ConfigErrorPanel } from "./system/ConfigErrorPanel";
import { HardwareStatusPanel } from "./system/HardwareStatusPanel";
import { MemoryPanel } from "./system/MemoryPanel";
import { ServicesPanel } from "./system/ServicesPanel";
import { FleetNetworkPanel } from "./system/FleetNetworkPanel";
import { AdapterStabilityCard } from "@/components/hardware/network/AdapterStabilityCard";
import { RadioNetworkHealthPanel } from "./system/RadioNetworkHealthPanel";
import { RegulatoryRegionPanel } from "./system/RegulatoryRegionPanel";
import { DashboardAccessPinCard } from "./system/DashboardAccessPinCard";
import { PluginHardwarePanels } from "./system/PluginHardwarePanels";
import { ComputeMetricsCard } from "./shared/ComputeMetricsCard";
import { ComputeClusterCard } from "./shared/ComputeClusterCard";
import type { NodeProfile } from "@/components/dashboard/node-detail/surface-types";
import type { RelayReach } from "@/lib/nodes/relay-reach";

interface SystemTabProps {
  /** The selected node's profile, from the surface render context. A
   * workstation (headless compute node) has no flight controller, radio link,
   * regulatory region, or fleet mesh, so those panels are hidden and the
   * compute / GPU and cluster cards take their place. Defaults to "drone". */
  profile?: NodeProfile;
  /** The node this page is rendered for. Handed to the panels that WRITE the
   * node's config so the write resolves its transport from this node rather
   * than from the focused-node connection store, which lags the render. */
  nodeDeviceId: string | null;
  /** The relaying ground station's reach for a WFB-relayed drone, else null. */
  relayReach?: RelayReach | null;
}

export function SystemTab({
  profile = "drone",
  nodeDeviceId,
  relayReach = null,
}: SystemTabProps) {
  const gate = useSurfaceGate("agent-online");

  const blocked = agentGateFallback(gate);
  if (blocked) return blocked;

  // Headless compute node: only compute-relevant panels.
  if (profile === "workstation") {
    return (
      <div className="p-4 space-y-4 max-w-5xl overflow-y-auto">
        <ConfigErrorPanel />
        <ComputeMetricsCard />
        <ComputeClusterCard />
        <MemoryPanel />
        <ServicesPanel />
        <DashboardAccessPinCard />
        {/* Fleet hardware.tab slot — a GCS-level plugin's hardware panels render
            here. Inert until a plugin contributes. */}
        <PluginHardwarePanels />
      </div>
    );
  }

  // Drone / ground-station: the full panel set (unchanged).
  return (
    <div className="p-4 space-y-4 max-w-5xl overflow-y-auto">
      <ConfigErrorPanel />
      <HardwareStatusPanel />
      <MemoryPanel />
      <ServicesPanel />
      <FleetNetworkPanel />
      <AdapterStabilityCard />
      <RadioNetworkHealthPanel />
      <RegulatoryRegionPanel
        nodeDeviceId={nodeDeviceId}
        relayReach={relayReach}
      />
      <DashboardAccessPinCard />
      {/* Fleet hardware.tab slot — a GCS-level plugin's hardware panels render
          here. Inert until a plugin contributes. */}
      <PluginHardwarePanels />
    </div>
  );
}
