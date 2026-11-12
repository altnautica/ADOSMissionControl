"use client";

/**
 * @module GroundStationOverview
 * @description Per-node overview for the `ground-station` profile.
 * Renders mesh role, paired-drone summary, RX link quality, uplink
 * status — the surface a ground-station operator needs at a glance.
 * The node's own ground-station tabs carry the full hardware configuration;
 * this is the landing summary.
 * @license GPL-3.0-only
 */

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useAgentSystemStore } from "@/stores/agent-system-store";
import { useGroundStationStore } from "@/stores/ground-station-store";
import { groundStationApiFromAgent } from "@/lib/api/ground-station-api";
import { useGroundStationPoll } from "../nodes/ground-station/use-gs-poll";
import { AgentStatusCard } from "../shared/AgentStatusCard";
import { SystemResourceGauges } from "../shared/SystemResourceGauges";
import { Sparkline } from "../shared/Sparkline";
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
import { NodeReachBlock } from "../shared/NodeReachBlock";
import { useNodeDirectAgent } from "../settings/use-node-direct-agent";
import { NodeNotAttachedNotice } from "./NodeNotAttachedNotice";
import { selectDeviceCapabilities, useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import { useLoraStore } from "@/stores/ground-station/lora-store";
import { GroundStationLoraChip } from "../nodes/ground-station/lora/LoraOverviewChip";

/** Cadence of the summary poll; the cards age out after a few misses. */
const GS_SUMMARY_POLL_MS = 3000;

export interface GroundStationOverviewProps {
  name?: string;
  /** The device id of the ground station the page shows. */
  nodeDeviceId: string | null;
}

export function GroundStationOverview({ name, nodeDeviceId }: GroundStationOverviewProps) {
  const t = useTranslations("agent");
  // The agent stores, the summary poll and Restart all ride the one attached
  // connection; on another node's page it is not this node's.
  const direct = useNodeDirectAgent(nodeDeviceId);
  const attachedConnected = useAgentConnectionStore((s) => s.connected);
  const connected = direct !== null && attachedConnected;
  const attachedStatus = useAgentSystemStore((s) => s.status);
  const status = direct !== null ? attachedStatus : null;
  const services = useAgentSystemStore((s) => s.services);
  const resources = useAgentSystemStore((s) => s.resources);
  const logs = useAgentSystemStore((s) => s.logs);
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
  const agentUrl = direct?.agentUrl ?? null;
  const apiKey = direct?.apiKey ?? null;
  const loadStatus = useGroundStationStore((s) => s.loadStatus);
  const invalidateLinkHealth = useGroundStationStore((s) => s.invalidateLinkHealth);
  const loadRole = useGroundStationStore((s) => s.loadRole);
  const loadMesh = useGroundStationStore((s) => s.loadMesh);
  const loadNetwork = useGroundStationStore((s) => s.loadNetwork);
  const loadLora = useLoraStore((s) => s.load);
  // This node's own remembered capability slice, never the shared
  // last-writer field, so another node's LoRa flag cannot gate this one.
  const loraAdvertised = useAgentCapabilitiesStore(
    (s) => selectDeviceCapabilities(s, nodeDeviceId)?.lora === true,
  );
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
    // The LoRa chip's governor state, only on a node that advertises the lane.
    if (loraAdvertised) await loadLora(api);
  });

  // Uplink health (ok / degraded / down) and the failover log arrive only on
  // the uplink event stream; the REST network read does not carry them, so
  // subscribe while the overview is mounted.
  const subscribeUplinkWs = useGroundStationStore((s) => s.subscribeUplinkWs);
  useEffect(() => {
    const api = groundStationApiFromAgent(agentUrl, apiKey);
    if (!api) return;
    return subscribeUplinkWs(api);
  }, [agentUrl, apiKey, subscribeUplinkWs]);

  if (!direct) {
    return (
      <div className="p-4 space-y-4">
        <NodeBrandHeader
          profile="ground-station"
          title={name || t("groundStationFallbackTitle")}
          nodeDeviceId={nodeDeviceId}
        />
        <NodeReachBlock deviceId={nodeDeviceId} />
        <NodeNotAttachedNotice />
      </div>
    );
  }

  if (!status) {
    if (!connected) {
      return (
        <>
          {/* Why this browser cannot use the node, when the reason is known
              (secure page, refused key, address taken by another agent). */}
          <div className="px-4 pt-4">
            <NodeReachBlock deviceId={nodeDeviceId} />
          </div>
          <AgentDisconnectedPage />
        </>
      );
    }
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
      <NodeBrandHeader profile="ground-station" title={title} nodeDeviceId={nodeDeviceId} />
      {loraAdvertised ? (
        <div className="flex flex-wrap gap-2">
          <GroundStationLoraChip agentUrl={agentUrl} apiKey={apiKey} />
        </div>
      ) : null}
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
            <Sparkline series="cpuHistory" tokenColor="--color-accent-primary" />
            <Sparkline series="memoryHistory" tokenColor="--color-text-secondary" />
          </div>
        </OverviewTile>
        <OverviewTile span="half">
          <ServiceTable
            services={services}
            onRestart={restartService}
            onRestartAll={restartAll}
          />
        </OverviewTile>
        <OverviewTile span="half">
          <LogViewer logs={logs} onRefresh={fetchLogs} />
        </OverviewTile>
      </OverviewGrid>
    </div>
  );
}
