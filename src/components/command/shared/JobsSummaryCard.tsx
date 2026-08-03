"use client";

/**
 * @module JobsSummaryCard
 * @description Compact live glance of a compute node's reconstruction / offload
 * jobs for the workstation Overview: running / queued / failed counts, the top
 * in-flight jobs with progress, and a deep-link to the full Jobs tab. Reads the
 * same local-first job source the Jobs tab uses (Rule 39); honest calm states
 * when the node is unreachable or Atlas is off — never a fabricated count.
 * @license GPL-3.0-only
 */

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Layers, ChevronRight } from "lucide-react";
import { StatusDot, type StatusLevel } from "@/components/ui/status-dot";
import { useUiStore } from "@/stores/ui-store";
import { useComputeJobs } from "@/hooks/use-compute-jobs";
import type { ComputeJob } from "@/lib/agent/compute-client";

function stateLevel(state: string): StatusLevel {
  switch (state) {
    case "running":
    case "completed":
      return "good";
    case "failed":
      return "critical";
    default:
      return "idle";
  }
}

function CountPill({
  level,
  label,
  value,
}: {
  level: StatusLevel;
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <StatusDot status={level} size="xs" />
      <span className="font-mono tabular-nums text-text-primary">{value}</span>
      <span className="text-text-tertiary">{label}</span>
    </div>
  );
}

export function JobsSummaryCard({ nodeId }: { nodeId?: string }) {
  const t = useTranslations("nodeConsole");
  const { jobs, loading, unreachable, client } = useComputeJobs(nodeId);
  const setPendingDetailTab = useUiStore((s) => s.setPendingDetailTab);

  const running = jobs.filter((j) => j.state === "running");
  const queued = jobs.filter((j) => j.state === "queued");
  const failed = jobs.filter((j) => j.state === "failed");
  // Top in-flight jobs: running first, then queued, capped at three.
  const top: ComputeJob[] = [...running, ...queued].slice(0, 3);

  let body: ReactNode;
  if (!client) {
    // Not local-first for this node (Atlas off / no LAN key): no counts.
    body = <p className="text-[11px] text-text-tertiary">{t("jobs.unavailable")}</p>;
  } else if (loading) {
    body = (
      <div className="flex items-center justify-center py-4">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-accent-primary border-t-transparent" />
      </div>
    );
  } else if (unreachable) {
    body = <p className="text-[11px] text-text-tertiary">{t("jobs.awaiting")}</p>;
  } else {
    body = (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
          <CountPill level="good" label={t("jobs.running")} value={running.length} />
          <CountPill level="idle" label={t("jobs.queued")} value={queued.length} />
          <CountPill
            level={failed.length ? "critical" : "idle"}
            label={t("jobs.failed")}
            value={failed.length}
          />
        </div>
        {top.length === 0 ? (
          <p className="text-[10px] text-text-tertiary">{t("jobs.none")}</p>
        ) : (
          <div className="space-y-1">
            {top.map((j) => (
              <div key={j.id} className="flex items-center gap-2">
                <StatusDot
                  status={stateLevel(j.state)}
                  size="xs"
                  pulse={j.state === "running"}
                />
                <span className="truncate font-mono text-[10px] text-text-secondary">
                  {j.kind}
                </span>
                {j.state === "running" && (
                  <div className="ml-auto h-1 w-16 overflow-hidden rounded-full bg-bg-tertiary">
                    <div
                      className="h-full rounded-full bg-accent-primary transition-all"
                      style={{ width: `${Math.min(j.progress * 100, 100)}%` }}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-2 rounded-lg border border-border-default bg-bg-secondary p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-text-tertiary">
          <Layers size={12} />
          <span>{t("jobs.title")}</span>
        </div>
        <button
          type="button"
          onClick={() => setPendingDetailTab("jobs")}
          className="group flex items-center gap-0.5 text-[10px] text-text-tertiary transition-colors hover:text-accent-primary"
        >
          {t("jobs.viewAll")}
          <ChevronRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
        </button>
      </div>
      {body}
    </div>
  );
}
