"use client";

/**
 * @module VisorOverview
 * @description Per-node overview for the `visor` profile: the agent's health,
 * the battery gauge, capture storage, the session clock, a rig summary and
 * the last capture session, then the host resources, services and logs. The
 * Sensors tab carries the full rig table; the capture extension's own tabs
 * carry recording and sessions.
 * @license GPL-3.0-only
 */

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useAgentSystemStore } from "@/stores/agent-system-store";
import { AgentStatusCard } from "../shared/AgentStatusCard";
import { SystemResourceGauges } from "../shared/SystemResourceGauges";
import { ServiceTable } from "../shared/ServiceTable";
import { LogViewer } from "../shared/LogViewer";
import { StaleBanner } from "../shared/StaleBanner";
import { NodeReachBlock } from "../shared/NodeReachBlock";
import { AgentDisconnectedPage } from "../AgentDisconnectedPage";
import { NodeBrandHeader } from "./NodeBrandHeader";
import { NodeNotAttachedNotice } from "./NodeNotAttachedNotice";
import { useNodeDirectAgent } from "../settings/use-node-direct-agent";
import { OverviewGrid, OverviewTile } from "./OverviewGrid";
import { useNodeSensors } from "../nodes/visor/use-node-sensors";
import { CloudModeLimitedNotice } from "../shared/CloudModeLimitedNotice";
import {
  BatteryCard,
  ClockCard,
  LastSessionCard,
  RigCard,
  StorageCard,
} from "../nodes/visor/VisorReadingCards";

export interface VisorOverviewProps {
  name?: string;
  nodeDeviceId: string | null;
}

export function VisorOverview({ name, nodeDeviceId }: VisorOverviewProps) {
  const t = useTranslations("visor.overview");
  // The agent stores and Restart ride the one attached connection; on another
  // node's page it is not this node's.
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
  const { reachable, readings, staleAt } = useNodeSensors(nodeDeviceId);

  useEffect(() => {
    if (connected) {
      fetchServices();
      fetchResources();
      fetchLogs();
    }
  }, [connected, fetchServices, fetchResources, fetchLogs]);

  if (!direct) {
    return (
      <div className="space-y-4 p-4">
        <NodeBrandHeader profile="visor" title={name || t("fallbackTitle")} nodeDeviceId={nodeDeviceId} />
        <NodeReachBlock deviceId={nodeDeviceId} />
        <NodeNotAttachedNotice />
      </div>
    );
  }

  if (!status) {
    if (!connected) {
      return (
        <>
          <div className="px-4 pt-4">
            <NodeReachBlock deviceId={nodeDeviceId} />
          </div>
          <AgentDisconnectedPage />
        </>
      );
    }
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent-primary border-t-transparent" />
        <p className="text-sm text-text-secondary">{t("waitingForStatus")}</p>
      </div>
    );
  }

  const title = name || status.board?.name || status.board?.model || t("fallbackTitle");
  return (
    <div className="space-y-4 p-4">
      <NodeBrandHeader profile="visor" title={title} nodeDeviceId={nodeDeviceId} />
      <StaleBanner />
      {/* Cloud-only reach: the sensor routes are LAN-only, so say so instead
          of leaving every reading card at "Not read yet". */}
      {!reachable && readings === null ? <CloudModeLimitedNotice feature="sensors" /> : null}
      <OverviewGrid>
        <OverviewTile span="half" rowSpan={2}>
          <AgentStatusCard status={status} profile="visor" />
        </OverviewTile>
        <OverviewTile span="quarter">
          <BatteryCard battery={readings?.battery} staleAt={staleAt.battery} />
        </OverviewTile>
        <OverviewTile span="quarter">
          <StorageCard storage={readings?.storage} staleAt={staleAt.storage} />
        </OverviewTile>
        <OverviewTile span="quarter">
          <ClockCard clock={readings?.clock} staleAt={staleAt.clock} />
        </OverviewTile>
        <OverviewTile span="quarter">
          <LastSessionCard sessions={readings?.sessions} staleAt={staleAt.sessions} />
        </OverviewTile>
        <OverviewTile span="full">
          <RigCard sensors={readings?.sensors} staleAt={staleAt.sensors} />
        </OverviewTile>
        <OverviewTile span="half">
          {resources && <SystemResourceGauges resources={resources} />}
        </OverviewTile>
        <OverviewTile span="half">
          <ServiceTable services={services} onRestart={restartService} onRestartAll={restartAll} />
        </OverviewTile>
        <OverviewTile span="full">
          <LogViewer logs={logs} onRefresh={fetchLogs} />
        </OverviewTile>
      </OverviewGrid>
    </div>
  );
}
