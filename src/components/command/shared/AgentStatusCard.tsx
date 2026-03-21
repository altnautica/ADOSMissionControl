"use client";

import { useTranslations } from "next-intl";
import {
  Cpu,
  Clock,
  Wifi,
  WifiOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/utils";
import type { AgentStatus } from "@/lib/agent/types";

interface AgentStatusCardProps {
  status: AgentStatus;
}

export function AgentStatusCard({ status }: AgentStatusCardProps) {
  const t = useTranslations("agent");
  return (
    <div className="border border-border-default rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-text-primary">{t("status")}</h3>
        <span className="text-xs font-mono text-text-tertiary">
          v{status.version}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <InfoRow icon={Cpu} label={t("board")} value={status.board?.name ?? t("unknown")} />
        <InfoRow label={t("tier")} value={String(status.board?.tier ?? "?")} />
        <InfoRow
          icon={Clock}
          label={t("uptime")}
          value={formatDuration(status.uptime_seconds)}
        />
        <InfoRow label={t("arch")} value={status.board?.arch ?? t("unknown")} />
        <InfoRow label={t("version")} value={`v${status.version}`} />
        <InfoRow label={t("soc")} value={status.board?.soc ?? t("unknown")} />
      </div>

      {/* Health stats */}
      {status.health && (
        <div className="flex items-center gap-4 text-xs text-text-secondary border-t border-border-default pt-2">
          <span>CPU {status.health.cpu_percent.toFixed(0)}%</span>
          <span>MEM {status.health.memory_percent.toFixed(0)}%</span>
          <span>DISK {status.health.disk_percent.toFixed(0)}%</span>
          {status.health.temperature != null && (
            <span>{status.health.temperature.toFixed(0)}°C</span>
          )}
        </div>
      )}

      <div className="flex items-center gap-4 pt-2 border-t border-border-default">
        <div className="flex items-center gap-1.5">
          {status.fc_connected ? (
            <Wifi size={12} className="text-status-success" />
          ) : (
            <WifiOff size={12} className="text-status-error" />
          )}
          <span
            className={cn(
              "text-xs",
              status.fc_connected ? "text-status-success" : "text-status-error"
            )}
          >
            {status.fc_connected ? t("fcConnected") : t("fcDisconnected")}
          </span>
        </div>
        {status.fc_connected && (
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
