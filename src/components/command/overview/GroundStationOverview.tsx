"use client";

/**
 * @module GroundStationOverview
 * @description Per-node overview for the `ground-station` profile.
 * Renders mesh role, paired-drone summary, RX link quality, uplink
 * status — the surface a ground-station operator needs at a glance.
 * The full hardware-config drilldown stays in `GroundStationDetailPanel`'s
 * 8-tab interior; this is the landing summary.
 * @license GPL-3.0-only
 */

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useAgentSystemStore } from "@/stores/agent-system-store";
import { useGroundStationStore } from "@/stores/ground-station-store";
import { useGroundStationPoll } from "../nodes/ground-station/use-gs-poll";
import { AgentStatusCard } from "../shared/AgentStatusCard";
import { SystemResourceGauges } from "../shared/SystemResourceGauges";
import { CpuSparkline } from "../shared/CpuSparkline";
import { MemorySparkline } from "../shared/MemorySparkline";
import { LogViewer } from "../shared/LogViewer";
import { ServiceTable } from "../shared/ServiceTable";
import { AgentDisconnectedPage } from "../AgentDisconnectedPage";
import { StaleBanner } from "../shared/StaleBanner";
import { GroundStationMeshCard } from "../shared/GroundStationMeshCard";
import { GroundStationLinkCard } from "../shared/GroundStationLinkCard";
import { GroundStationUplinkCard } from "../shared/GroundStationUplinkCard";
import { GroundStationVideoCard } from "../shared/GroundStationVideoCard";
import { PairedDroneCard } from "../shared/PairedDroneCard";
import { NodeBrandHeader } from "./NodeBrandHeader";
import { OverviewGrid, OverviewTile } from "./OverviewGrid";

/** Cadence of the summary poll; the cards age out after a few misses. */
const GS_SUMMARY_POLL_MS = 3000;

export function GroundStationOverview({ name }: { name?: string }) {
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

  // The summary cards below read the status, role, mesh and uplink slices.
  // Nothing else keeps them current on this landing page (their writers are
  // the Radio, Mesh and Network tabs), so poll them here. A failed status read
  // drops the link snapshot rather than leaving the last one standing; every
  // other slice keeps its refresh stamp and ages out on its own.
  const agentUrl = useAgentConnectionStore((s) => s.agentUrl);
  const apiKey = useAgentConnectionStore((s) => s.apiKey);
  const loadStatus = useGroundStationStore((s) => s.loadStatus);
  const invalidateLinkHealth = useGroundStationStore((s) => s.invalidateLinkHealth);
  const loadRole = useGroundStationStore((s) => s.loadRole);
  const loadMesh = useGroundStationStore((s) => s.loadMesh);
  const loadNetwork = useGroundStationStore((s) => s.loadNetwork);
  useGroundStationPoll(agentUrl, apiKey, GS_SUMMARY_POLL_MS, async (api) => {
    try {
      const gs = await api.getStatus();
      loadStatus(
        {
          paired_drone: gs.paired_drone ?? null,
          profile: gs.profile ?? "unconfigured",
          uplink_active: gs.uplink_active ?? null,
        },
        gs.link_health,
      );
    } catch (err) {
      invalidateLinkHealth(err instanceof Error ? err.message : "status read failed");
      throw err;
    }
    await loadRole(api);
    await loadMesh(api);
    await loadNetwork(api);
  });

  if (!status) {
    if (!connected) return <AgentDisconnectedPage />;
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <div className="w-5 h-5 border-2 border-accent-primary border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-text-secondary">{t("waitingForStatus")}</p>
      </div>
    );
  }

  const title =
    name ||
    status.board?.name ||
    status.board?.model ||
    t("groundStationFallbackTitle");
  return (
    <div className="p-4 space-y-4">
      <NodeBrandHeader profile="ground-station" title={title} />
      <StaleBanner />
      <OverviewGrid>
        <OverviewTile span="half">
          <AgentStatusCard status={status} profile="ground-station" />
        </OverviewTile>
        <OverviewTile span="half">
          <GroundStationLinkCard />
        </OverviewTile>
        <OverviewTile span="third">
          <PairedDroneCard />
        </OverviewTile>
        <OverviewTile span="third">
          <GroundStationUplinkCard />
        </OverviewTile>
        <OverviewTile span="third">
          <GroundStationMeshCard />
        </OverviewTile>
        <OverviewTile span="half">
          <GroundStationVideoCard />
        </OverviewTile>
        <OverviewTile span="half">
          <div className="space-y-3">
            {resources && <SystemResourceGauges resources={resources} />}
            <CpuSparkline />
            <MemorySparkline />
          </div>
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
        <OverviewTile span="half">
          <LogViewer logs={logs} onRefresh={fetchLogs} />
        </OverviewTile>
      </OverviewGrid>
    </div>
  );
}
