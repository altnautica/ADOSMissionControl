"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { RotateCw, AlertTriangle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDurationSeconds } from "@/lib/i18n/format";
import type { ServiceInfo } from "@/lib/agent/types";
import { countRunning } from "@/lib/agent/service-state";
import { nodeIdForDevice } from "@/lib/agent/node-id";
import { useVideoStore } from "@/stores/video-store";
import { useAgentConnectionStore } from "@/stores/agent-connection";
import { useNodeRegistryStore } from "@/stores/node-registry";
import { useFreshness } from "@/lib/agent/freshness";
import { useToast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface ServiceTableProps {
  services: ServiceInfo[];
  /** Resolves with the agent's confirmation (null when queued over the
   * cloud relay); rejects with the agent's reason on a failed restart. */
  onRestart: (name: string) => Promise<string | null>;
  onRestartAll?: () => Promise<string>;
  processCpu?: number | null;
  processMemoryMb?: number | null;
}

function statusBadge(status: string, stale: boolean) {
  const colors: Record<string, string> = {
    running: "bg-status-success/20 text-status-success",
    stopped: "bg-text-tertiary/20 text-text-tertiary",
    error: "bg-status-error/20 text-status-error",
    degraded: "bg-status-warning/20 text-status-warning",
    starting: "bg-accent-primary/20 text-accent-primary",
    circuit_open: "bg-status-error/20 text-status-error",
  };
  // When the feed is stale we can't vouch for these states — render every
  // badge in the neutral tertiary tone so "running" doesn't read as a live
  // confirmation.
  const staleStyle = "bg-text-tertiary/20 text-text-tertiary";
  return (
    <span
      className={cn(
        "inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded",
        stale ? staleStyle : (colors[status] ?? colors.stopped)
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

/**
 * Units whose restart interrupts the vehicle's flight link, radio, video,
 * RC path or the GCS's reach to the node. Keyed without the `ados-` prefix.
 */
const LINK_CRITICAL_UNITS: Record<string, true> = {
  mavlink: true,
  control: true,
  wfb: true,
  "wfb-rx": true,
  "wfb-relay": true,
  crsf: true,
  video: true,
  cloud: true,
  "uplink-router": true,
  supervisor: true,
};

type RestartTarget = { kind: "one"; name: string } | { kind: "all" };

/** In-flight key for the restart-all action; never a unit name. */
const ALL_KEY = "*";

export function ServiceTable({ services, onRestart, onRestartAll, processCpu, processMemoryMb }: ServiceTableProps) {
  const t = useTranslations("agent");
  const agentDependencies = useVideoStore((s) => s.agentDependencies);
  const freshness = useFreshness();
  const { toast } = useToast();
  const nodeDeviceId = useAgentConnectionStore((s) => s.nodeDeviceId);
  const vehicleArmed = useNodeRegistryStore((s) =>
    nodeDeviceId ? s.nodes[nodeIdForDevice(nodeDeviceId)]?.fc.armState === "armed" : false,
  );
  const [confirmTarget, setConfirmTarget] = useState<RestartTarget | null>(null);
  const [inFlight, setInFlight] = useState<Record<string, true>>({});
  const isStale = freshness.state !== "live" && freshness.state !== "unknown";

  const runRestart = (target: RestartTarget) => {
    const key = target.kind === "all" ? ALL_KEY : target.name;
    const pending =
      target.kind === "all" && onRestartAll ? onRestartAll() : target.kind === "one" ? onRestart(target.name) : null;
    if (!pending) return;
    setInFlight((s) => ({ ...s, [key]: true }));
    pending
      .then(
        (message) => {
          // Null means the restart was queued over the cloud relay, where no
          // answer comes back on this request.
          if (message) toast(message, "success");
          else toast(t("restartQueued", { name: key }), "info");
        },
        (err: unknown) => toast(err instanceof Error ? err.message : String(err), "error"),
      )
      .finally(() =>
        setInFlight((s) => {
          const next = { ...s };
          delete next[key];
          return next;
        }),
      );
  };

  const confirmCritical =
    confirmTarget?.kind === "all" ||
    (confirmTarget?.kind === "one" && LINK_CRITICAL_UNITS[confirmTarget.name.replace(/^ados-/, "")] === true);
  const armedWarning = vehicleArmed && confirmCritical;
  const confirmDialog = (
    <ConfirmDialog
      open={confirmTarget !== null}
      title={
        confirmTarget?.kind === "one"
          ? t("restartConfirmTitle", { name: confirmTarget.name })
          : t("restartAllConfirmTitle")
      }
      message={[
        confirmTarget?.kind === "one"
          ? t("restartConfirmMessage", { name: confirmTarget.name })
          : t("restartAllConfirmMessage"),
        armedWarning ? t("restartArmedWarning") : "",
      ]
        .filter(Boolean)
        .join(" ")}
      confirmLabel={t("restartConfirmLabel")}
      variant={armedWarning ? "danger" : "primary"}
      onCancel={() => setConfirmTarget(null)}
      onConfirm={() => {
        if (confirmTarget) runRestart(confirmTarget);
        setConfirmTarget(null);
      }}
    />
  );

  if (!services || !Array.isArray(services) || services.length === 0) {
    return (
      <div className="border border-border-default rounded-lg p-4">
        <h3 className="text-sm font-medium text-text-primary mb-2">{t("services")}</h3>
        <p className="text-xs text-text-tertiary">{t("noServicesReported")}</p>
      </div>
    );
  }

  const runningCount = countRunning(services);
  // Detect multi-process mode: if any service has a real PID, show per-service columns
  const hasRealPids = services.some((s) => s.pid != null && s.pid > 0);

  return (
    <div
      className={cn(
        "border border-border-default rounded-lg p-4 transition-opacity",
        isStale && "opacity-60"
      )}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-text-primary">{t("services")}</h3>
          {isStale && (
            <span
              className={cn(
                "text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded font-semibold",
                freshness.state === "offline"
                  ? "bg-status-error/15 text-status-error"
                  : "bg-status-warning/15 text-status-warning"
              )}
            >
              Data stale
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-[10px] text-text-tertiary font-mono">
          <span>{runningCount}/{services.length} running</span>
          {onRestartAll && (
            <button
              onClick={() => setConfirmTarget({ kind: "all" })}
              disabled={inFlight[ALL_KEY] === true}
              className="p-1 rounded hover:bg-bg-tertiary text-text-tertiary hover:text-text-primary transition-colors disabled:opacity-50"
              title={t("restartAllServices")}
              aria-label={t("restartAllServices")}
            >
              {inFlight[ALL_KEY] ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RotateCw className="w-3.5 h-3.5" />
              )}
            </button>
          )}
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
                <td className="py-1.5 pr-3">{statusBadge(svc.status, isStale)}</td>
                {hasRealPids && (
                  <>
                    <td className="py-1.5 pr-3 text-right text-text-secondary font-mono">
                      {svc.pid ?? "-"}
                    </td>
                    <td className="py-1.5 pr-3 text-right text-text-secondary font-mono">
                      {svc.status === "running" && svc.cpu_percent != null ? svc.cpu_percent.toFixed(1) : "—"}
                    </td>
                    <td className="py-1.5 pr-3 text-right text-text-secondary font-mono">
                      {svc.status === "running" && svc.memory_mb != null ? svc.memory_mb.toFixed(1) : "—"}
                    </td>
                  </>
                )}
                <td className="py-1.5 pr-3 text-right text-text-secondary font-mono">
                  {svc.status === "running" ? formatDurationSeconds(svc.uptime_seconds) : "—"}
                </td>
                <td className="py-1.5 text-right">
                  <button
                    onClick={() => setConfirmTarget({ kind: "one", name: svc.name })}
                    disabled={inFlight[svc.name] === true || inFlight[ALL_KEY] === true}
                    className="p-1 text-text-tertiary hover:text-accent-primary transition-colors disabled:opacity-50"
                    title={t("restartService", { name: svc.name })}
                    aria-label={t("restartService", { name: svc.name })}
                  >
                    {inFlight[svc.name] ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <RotateCw size={12} />
                    )}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {confirmDialog}
    </div>
  );
}
