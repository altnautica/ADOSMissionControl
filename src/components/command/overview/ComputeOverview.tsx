"use client";

/**
 * @module ComputeOverview
 * @description Per-node overview for the `compute` profile (NPU-only
 * boards used as headless inference / mesh / relay companions, no FC,
 * no video pipeline). Renders status, resources, compute metrics, and
 * services. Hides FC / video / RC / battery cards.
 * @license GPL-3.0-only
 */

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useAgentSystemStore } from "@/stores/agent-system-store";
import { AgentStatusCard } from "../shared/AgentStatusCard";
import { ServiceTable } from "../shared/ServiceTable";
import { SystemResourceGauges } from "../shared/SystemResourceGauges";
import { Sparkline } from "../shared/Sparkline";
import { LogViewer } from "../shared/LogViewer";
import { AgentDisconnectedPage } from "../AgentDisconnectedPage";
import { StaleBanner } from "../shared/StaleBanner";
import { ComputeMetricsCard } from "../shared/ComputeMetricsCard";
import { ComputeClusterCard } from "../shared/ComputeClusterCard";
import { JobsSummaryCard } from "../shared/JobsSummaryCard";
import { NodeReachBlock } from "../shared/NodeReachBlock";
import { deviceIdFromNodeId } from "@/lib/agent/node-id";
import { NodeBrandHeader } from "./NodeBrandHeader";
import { OverviewGrid, OverviewTile } from "./OverviewGrid";
import { useComputeLocalState } from "@/hooks/use-compute-local-state";

export function ComputeOverview({ nodeId }: { nodeId?: string }) {
  // Local-first: poll this compute node's cluster status directly when
  // LAN-paired (signed out), feeding the same store the cloud heartbeat feeds.
  useComputeLocalState(nodeId);
  const t = useTranslations("agent");
  const connected = useAgentConnectionStore((s) => s.connected);
  const status = useAgentSystemStore((s) => s.status);
  const services = useAgentSystemStore((s) => s.services);
  const resources = useAgentSystemStore((s) => s.resources);
  const logs = useAgentSystemStore((s) => s.logs);
  const processCpu = useAgentSystemStore((s) => s.processCpuPercent);
  const processMemMb = useAgentSystemStore((s) => s.processMemoryMb);
  const fetchServices = useAgentSystemStore((s) => s.fetchServices);
  const fetchResources = useAgentSystemStore((s) => s.fetchResources);
  const fetchLogs = useAgentSystemStore((s) => s.fetchLogs);
  const restartService = useAgentSystemStore((s) => s.restartService);
  const restartAll = useAgentSystemStore((s) => s.restartAll);

  useEffect(() => {
    if (connected) {
      fetchServices();
      fetchResources();
      fetchLogs();
    }
  }, [connected, fetchServices, fetchResources, fetchLogs]);

  if (!status) {
    if (!connected) return <AgentDisconnectedPage />;
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <div className="w-5 h-5 border-2 border-accent-primary border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-text-secondary">{t("waitingForStatus")}</p>
      </div>
    );
  }

  // The shared brand hero + the unified overview grid, with GPU folded in as
  // vitals and a live Jobs glance.
  const host = status.board?.name || status.board?.model || "—";
  return (
    <div className="h-full space-y-4 overflow-y-auto p-4">
      <StaleBanner />
      <NodeBrandHeader profile="workstation" title={host} />
      <NodeReachBlock
        deviceId={nodeId ? (deviceIdFromNodeId(nodeId) ?? nodeId) : ""}
      />
      {/* Surface the compute node's LAN posture: its job API + world-model
          artifacts are reachable by drones and other GCS on the same network,
          and that exposure is pairing-gated. */}
      <p className="text-xs text-text-secondary">{t("computeLanNote")}</p>

      <OverviewGrid>
        {/* GPU · Compute — GPU util lives here, not a separate tab */}
        <OverviewTile span="third">
          <div className="space-y-3">
            <ComputeMetricsCard profile="workstation" />
            <Sparkline series="gpuHistory" tokenColor="--node-swatch-cyan" />
          </div>
        </OverviewTile>

        {/* System */}
        <OverviewTile span="third">
          <div className="space-y-3">
            <AgentStatusCard status={status} profile="workstation" />
            {resources && <SystemResourceGauges resources={resources} />}
            <Sparkline series="cpuHistory" tokenColor="--color-accent-primary" />
            <Sparkline series="memoryHistory" tokenColor="--color-accent-secondary" />
          </div>
        </OverviewTile>

        {/* Compute work — cluster + a live jobs glance */}
        <OverviewTile span="third">
          <div className="space-y-3">
            <ComputeClusterCard />
            <JobsSummaryCard nodeId={nodeId} />
          </div>
        </OverviewTile>

        {/* Activity */}
        <OverviewTile span="half">
          <LogViewer logs={logs} onRefresh={fetchLogs} />
        </OverviewTile>
        <OverviewTile span="half">
          <ServiceTable
            services={services}
            onRestart={restartService}
            onRestartAll={restartAll}
            processCpu={processCpu}
            processMemoryMb={processMemMb}
          />
        </OverviewTile>
      </OverviewGrid>
    </div>
  );
}
