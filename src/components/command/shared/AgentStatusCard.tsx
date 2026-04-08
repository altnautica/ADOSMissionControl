"use client";

import { useTranslations } from "next-intl";
import {
  Cpu,
  Clock,
  Wifi,
  WifiOff,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/utils";
import type { AgentStatus } from "@/lib/agent/types";
import { useAgentSystemStore } from "@/stores/agent-system-store";
import { useFreshness } from "@/lib/agent/freshness";

interface AgentStatusCardProps {
  status: AgentStatus;
}

export function AgentStatusCard({ status }: AgentStatusCardProps) {
  const t = useTranslations("agent");
  // Read dynamic values directly from system store — the status prop may be stale
  // due to cross-store Zustand update batching issues
  const resources = useAgentSystemStore((s) => s.resources);
  const services = useAgentSystemStore((s) => s.services);
  const cpuHistory = useAgentSystemStore((s) => s.cpuHistory);
  const freshness = useFreshness();
  const isStale = freshness.state !== "live" && freshness.state !== "unknown";
  const cpuPct = resources?.cpu_percent ?? status.health?.cpu_percent ?? 0;
  const memPct = resources?.memory_percent ?? status.health?.memory_percent ?? 0;
  const diskPct = resources?.disk_percent ?? status.health?.disk_percent ?? 0;
  const temp = resources?.temperature ?? status.health?.temperature ?? null;
  // FC connected: infer from services — if ados-mavlink is running, FC is likely connected
  // Also check status prop as backup
  const fcFromServices = services.some(s => s.name === "ados-mavlink" && s.status === "running");
  const fcConnected = status.fc_connected || fcFromServices;
  // Uptime: estimate from cpuHistory length (each entry ~5s) if status.uptime_seconds is 0
  const uptimeSeconds = status.uptime_seconds || (cpuHistory.length * 5);
  return (
    <div
      className={cn(
        "border border-border-default rounded-lg p-4 space-y-3 transition-opacity",
        isStale && "opacity-60"
      )}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-text-primary">{t("status")}</h3>
        <span className="text-xs font-mono text-text-tertiary">
          v{status.version}
        </span>
      </div>

      {isStale && (
        <div
          className={cn(
            "flex items-center gap-1.5 text-[11px] px-2 py-1 rounded",
            freshness.state === "offline"
              ? "bg-status-error/10 text-status-error"
              : "bg-status-warning/10 text-status-warning"
          )}
        >
          <AlertTriangle size={12} />
          <span>
            {freshness.state === "offline" ? "Agent offline" : "Stale data"} ·
            last update {freshness.label}
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <InfoRow icon={Cpu} label={t("board")} value={status.board?.name ?? t("unknown")} />
        <InfoRow label={t("tier")} value={String(status.board?.tier ?? "?")} />
        <InfoRow
          icon={Clock}
          label={t("uptime")}
          value={formatDuration(uptimeSeconds)}
        />
        <InfoRow label={t("arch")} value={status.board?.arch ?? t("unknown")} />
        <InfoRow label={t("version")} value={`v${status.version}`} />
        <InfoRow label={t("soc")} value={status.board?.soc ?? t("unknown")} />
      </div>

      {/* Health stats */}
      <div className="flex items-center gap-4 text-xs text-text-secondary border-t border-border-default pt-2">
        <span>CPU {cpuPct.toFixed(0)}%</span>
        <span>MEM {memPct.toFixed(0)}%</span>
        <span>DISK {diskPct.toFixed(0)}%</span>
        {temp != null && (
          <span>{temp.toFixed(0)}°C</span>
        )}
      </div>

      <div className="flex items-center gap-4 pt-2 border-t border-border-default">
        <div className="flex items-center gap-1.5">
          {fcConnected ? (
            <Wifi
              size={12}
              className={isStale ? "text-status-warning" : "text-status-success"}
            />
          ) : (
            <WifiOff size={12} className="text-status-error" />
          )}
          <span
            className={cn(
              "text-xs",
              fcConnected
                ? isStale
                  ? "text-status-warning"
                  : "text-status-success"
                : "text-status-error"
            )}
          >
            {fcConnected ? t("fcConnected") : t("fcDisconnected")}
            {isStale && fcConnected && (
              <span className="text-text-tertiary"> (unverified)</span>
            )}
          </span>
        </div>
        {fcConnected && status.fc_port && (
          <span className="text-xs text-text-tertiary">
            {status.fc_port} @ {status.fc_baud}
          </span>
        )}
      </div>
    </div>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon?: typeof Cpu;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2">
      {Icon && <Icon size={12} className="text-text-tertiary" />}
      <span className="text-xs text-text-tertiary">{label}</span>
      <span className="text-xs text-text-primary font-mono ml-auto">
        {value}
      </span>
    </div>
  );
}
