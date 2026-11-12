"use client";

/**
 * @module vision/PerceptionUsageCard
 * @description Compute usage for the Perception hub: the node's core (CPU /
 * memory / disk / temp) gauges plus an NPU-utilization bar. The NPU bar renders
 * ONLY when the engine forwards a real utilization value (no
 * fabricated 0); otherwise a calm "not reported" line stands. Reuses the same
 * ResourceBar the system gauges use so the NPU bar reads on the same scale.
 * @license GPL-3.0-only
 */

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Activity, AlertTriangle, Cpu } from "lucide-react";

import {
  ResourceBar,
  SystemResourceGauges,
} from "@/components/command/shared/SystemResourceGauges";
import { useAgentSystemStore } from "@/stores/agent-system-store";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useVisionEngineStatus, type VisionEngineConnection } from "@/hooks/use-vision-engine-models";

const REFRESH_MS = 5000;

/**
 * @param agent The rendered node's own connection; null when it has none, so
 *   neither another node's gauges nor its engine show here. Omitted: the
 *   attached connection.
 */
export function PerceptionUsageCard({ agent }: { agent?: VisionEngineConnection | null } = {}) {
  const tv = useTranslations("vision");
  const ta = useTranslations("computeMetrics");
  const ambientResources = useAgentSystemStore((s) => s.resources);
  const fetchResources = useAgentSystemStore((s) => s.fetchResources);
  const ambientConnected = useAgentConnectionStore((s) => s.connected);
  const status = useVisionEngineStatus(agent);
  const ownNode = agent !== null;
  const resources = ownNode ? ambientResources : null;
  const connected = ownNode && ambientConnected;

  // Keep the core gauges fresh while the hub is open (no-op in cloud mode /
  // without a client — the store guards both).
  useEffect(() => {
    if (!connected) return;
    void fetchResources();
    const id = setInterval(() => void fetchResources(), REFRESH_MS);
    return () => clearInterval(id);
  }, [connected, fetchResources]);

  const npuUtil = status.known ? status.npuUtilizationPct : null;
  // A detector backend that is not running a real model is said so, never
  // shown as a working detector.
  const backendNotice =
    status.known && status.backendState === "unavailable"
      ? tv("backendUnavailable", { reason: status.backendReason ?? tv("backendReasonUnknown") })
      : status.known && status.backendState === "mock"
        ? tv("backendMock")
        : null;

  return (
    <section className="rounded border border-border-default bg-bg-secondary p-3 space-y-3">
      <h3 className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-text-secondary">
        <Cpu size={13} aria-hidden="true" />
        {tv("usageTitle")}
      </h3>
      {backendNotice && (
        <div
          role="status"
          className="flex items-start gap-1.5 rounded border border-status-warning/40 px-2 py-1.5 text-[11px] text-status-warning"
        >
          <AlertTriangle size={12} className="mt-px flex-shrink-0" aria-hidden="true" />
          <span>{backendNotice}</span>
        </div>
      )}

      {resources ? (
        <SystemResourceGauges resources={resources} />
      ) : (
        <div className="text-[10px] text-text-tertiary text-center py-2">
          {ownNode ? tv("coreUsageAwaiting") : tv("coreUsageUnreachable")}
        </div>
      )}

      {/* NPU — truthful: rendered only when the node reports a real value. */}
      <div className="border-t border-border-default pt-2">
        {npuUtil != null ? (
          <ResourceBar
            icon={Activity}
            label={ta("npu")}
            percent={npuUtil}
            detail={ta("utilization", { pct: npuUtil.toFixed(1) })}
            stale={false}
            staleLabel=""
          />
        ) : (
          <div className="flex items-center gap-1.5 text-[10px] text-text-tertiary">
            <Activity size={10} className="flex-shrink-0" aria-hidden="true" />
            <span>{tv("npuUtilizationUnavailable")}</span>
          </div>
        )}
      </div>
    </section>
  );
}
