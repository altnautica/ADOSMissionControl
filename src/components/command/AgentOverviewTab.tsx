"use client";

/**
 * @module AgentOverviewTab
 * @description Main overview tab showing agent status, services, resources, CPU/memory sparklines, and logs.
 * @license GPL-3.0-only
 */

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useAgentSystemStore } from "@/stores/agent-system-store";
import { AgentStatusCard } from "./shared/AgentStatusCard";
import { ServiceTable } from "./shared/ServiceTable";
import { SystemResourceGauges } from "./shared/SystemResourceGauges";
import { CpuSparkline } from "./shared/CpuSparkline";
import { MemorySparkline } from "./shared/MemorySparkline";
import { LogViewer } from "./shared/LogViewer";
import { AgentDisconnectedPage } from "./AgentDisconnectedPage";
import { VideoFeedCard } from "./shared/VideoFeedCard";
import { BatteryCard } from "./shared/BatteryCard";
import { RcInputCard } from "./shared/RcInputCard";
import { FlightDataCard } from "./shared/FlightDataCard";

export function AgentOverviewTab() {
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

  useEffect(() => {
    if (connected) {
      fetchServices();
      fetchResources();
      fetchLogs();
    }
  }, [connected, fetchServices, fetchResources, fetchLogs]);

  if (!connected) {
    return <AgentDisconnectedPage />;
  }

  if (!status) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <div className="w-5 h-5 border-2 border-accent-primary border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-text-secondary">{t("waitingForStatus")}</p>
        <p className="text-xs text-text-tertiary">{t("shouldReportShortly")}</p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {/* Agent Status spans 2/3, Flight Telemetry column starts at top */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Status card spans 2 columns */}
        <div className="xl:col-span-2">
          {status && <AgentStatusCard status={status} />}
        </div>

        {/* Column 3: Video + Flight Telemetry (starts at same level as status) */}
        <div className="xl:row-span-3 space-y-3">
          <VideoFeedCard />
          <FlightDataCard />
          <RcInputCard />
        </div>

        {/* Below status: 2 columns — logs+services left, resources right */}
        <div className="space-y-4">
          <LogViewer logs={logs} onRefresh={fetchLogs} />
          <ServiceTable
            services={services}
            onRestart={restartService}
            processCpu={processCpu}
            processMemoryMb={processMemMb}
          />
        </div>

        <div className="space-y-4">
          {resources && <SystemResourceGauges resources={resources} />}
          <CpuSparkline />
          <MemorySparkline />
          <BatteryCard />
        </div>
      </div>
    </div>
  );
}
