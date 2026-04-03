"use client";

import { useTranslations } from "next-intl";
import { RotateCw, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/utils";
import type { ServiceInfo } from "@/lib/agent/types";
import { useVideoStore } from "@/stores/video-store";

interface ServiceTableProps {
  services: ServiceInfo[];
  onRestart: (name: string) => void;
  processCpu?: number | null;
  processMemoryMb?: number | null;
}

function statusBadge(status: string) {
  const colors: Record<string, string> = {
    running: "bg-status-success/20 text-status-success",
    stopped: "bg-text-tertiary/20 text-text-tertiary",
    error: "bg-status-error/20 text-status-error",
    degraded: "bg-status-warning/20 text-status-warning",
    starting: "bg-accent-primary/20 text-accent-primary",
    circuit_open: "bg-status-error/20 text-status-error",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded",
        colors[status] ?? colors.stopped
      )}
    >
      {status === "circuit_open" ? "breaker" : status}
    </span>
  );
}

const categoryColors: Record<string, string> = {
  core: "text-accent-primary",
  hardware: "text-status-warning",
  suite: "text-accent-secondary",
  ondemand: "text-text-tertiary",
};

export function ServiceTable({ services, onRestart, processCpu, processMemoryMb }: ServiceTableProps) {
  const t = useTranslations("agent");
  const agentDependencies = useVideoStore((s) => s.agentDependencies);
  if (!services || !Array.isArray(services) || services.length === 0) {
    return (
      <div className="border border-border-default rounded-lg p-4">
        <h3 className="text-sm font-medium text-text-primary mb-2">{t("services")}</h3>
        <p className="text-xs text-text-tertiary">{t("noServicesReported")}</p>
      </div>
    );
  }

  const runningCount = services.filter((s) => s.status === "running").length;
  // Detect multi-process mode: if any service has a real PID, show per-service columns
  const hasRealPids = services.some((s) => s.pid != null && s.pid > 0);

  return (
    <div className="border border-border-default rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-text-primary">{t("services")}</h3>
        <div className="flex items-center gap-3 text-[10px] text-text-tertiary font-mono">
          <span>{runningCount}/{services.length} running</span>
          {processCpu != null && (
            <span>CPU {processCpu.toFixed(1)}%</span>
          )}
          {processMemoryMb != null && (
            <span>RAM {processMemoryMb.toFixed(0)} MB</span>
          )}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border-default text-text-tertiary">
              <th className="text-left py-1.5 pr-3 font-medium">{t("serviceName")}</th>
              <th className="text-left py-1.5 pr-3 font-medium">{t("serviceStatus")}</th>
              {hasRealPids && (
                <>
                  <th className="text-right py-1.5 pr-3 font-medium">{t("servicePid")}</th>
                  <th className="text-right py-1.5 pr-3 font-medium">{t("serviceCpu")}</th>
                  <th className="text-right py-1.5 pr-3 font-medium">{t("serviceRam")}</th>
                </>
              )}
              <th className="text-right py-1.5 pr-3 font-medium">{t("serviceUptime")}</th>
              <th className="text-right py-1.5 font-medium">{t("serviceAction")}</th>
            </tr>
          </thead>
          <tbody>
            {services.map((svc) => (
              <tr
                key={svc.name}
                className="border-b border-border-default last:border-b-0"
              >
                <td className="py-1.5 pr-3 text-text-primary font-mono">
                  <div className="flex items-center gap-1.5">
                    {svc.category && (
                      <span className={cn("text-[8px] uppercase", categoryColors[svc.category] ?? "text-text-tertiary")}>
                        {svc.category === "core" ? "C" : svc.category === "hardware" ? "H" : svc.category === "suite" ? "S" : "D"}
                      </span>
                    )}
                    {svc.name}
                    {svc.name === "ados-video" &&
                      (svc.status === "error" || svc.status === "stopped") &&
                      agentDependencies && (() => {
                        const missing = Object.entries(agentDependencies)
                          .filter(([, v]) => !v.found)
                          .map(([k]) => k);
                        if (missing.length === 0) return null;
                        return (
                          <span
                            className="inline-flex items-center gap-0.5 text-status-warning"
                            title={`Missing: ${missing.join(", ")}`}
                          >
                            <AlertTriangle size={10} />
                          </span>
                        );
                      })()}
                  </div>
                </td>
                <td className="py-1.5 pr-3">{statusBadge(svc.status)}</td>
                {hasRealPids && (
                  <>
                    <td className="py-1.5 pr-3 text-right text-text-secondary font-mono">
                      {svc.pid ?? "-"}
                    </td>
                    <td className="py-1.5 pr-3 text-right text-text-secondary font-mono">
                      {svc.status === "running" ? (svc.cpu_percent ?? 0).toFixed(1) : "-"}
                    </td>
                    <td className="py-1.5 pr-3 text-right text-text-secondary font-mono">
                      {svc.status === "running" ? (svc.memory_mb ?? 0).toFixed(1) : "-"}
                    </td>
                  </>
                )}
                <td className="py-1.5 pr-3 text-right text-text-secondary font-mono">
                  {svc.status === "running" ? formatDuration(svc.uptime_seconds) : "-"}
                </td>
                <td className="py-1.5 text-right">
                  <button
                    onClick={() => onRestart(svc.name)}
                    className="p-1 text-text-tertiary hover:text-accent-primary transition-colors"
                    title={t("restartService", { name: svc.name })}
                  >
                    <RotateCw size={12} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
