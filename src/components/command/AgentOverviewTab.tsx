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
    <div className="p-4 space-y-4 max-w-5xl">
      <AgentStatusCard status={status} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ServiceTable
          services={services}
          onRestart={restartService}
          processCpu={processCpu}
          processMemoryMb={processMemMb}
        />
        <div className="space-y-4">
          {resources && <SystemResourceGauges resources={resources} />}
          <CpuSparkline />
          <MemorySparkline />
        </div>
      </div>

      <LogViewer logs={logs} onRefresh={fetchLogs} />
    </div>
  );
}
