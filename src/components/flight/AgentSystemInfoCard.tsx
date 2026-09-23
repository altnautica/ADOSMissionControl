"use client";

/**
 * @module AgentSystemInfoCard
 * @description Read-only system/hardware card for the drone detail
 * panel. Surfaces the running kernel release, the WFB radio kernel
 * module source (prebuilt / dkms / none), and the agent install-health
 * pill (ok / degraded / failed / unknown). When the install is degraded
 * or failed, the failed install steps expand below the pill.
 *
 * Every field is optional and undefined-safe: an older agent that does
 * not report these fields renders nothing, so the card only appears
 * once the agent advertises at least one of them.
 *
 * The values are the agent's last report. While the agent is not answering
 * the card dims, every badge drops to neutral (a green "OK" is a claim about
 * now) and the header says when the agent was last heard.
 *
 * @license GPL-3.0-only
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import { useAgentSystemStore } from "@/stores/agent-system-store";
import { useFreshness } from "@/lib/agent/freshness";
import { cn } from "@/lib/utils";
import type { InstallStatus, WfbModuleSource } from "@/lib/agent/types";

type BadgeVariant = "success" | "warning" | "error" | "info" | "neutral";

const WFB_VARIANT: Record<WfbModuleSource, BadgeVariant> = {
  prebuilt: "success",
  dkms: "success",
  none: "neutral",
};

const INSTALL_VARIANT: Record<InstallStatus, BadgeVariant> = {
  ok: "success",
  degraded: "warning",
  failed: "error",
  unknown: "neutral",
};

export function AgentSystemInfoCard() {
  const t = useTranslations("flightInfo");
  const status = useAgentSystemStore((s) => s.status);
  const [stepsOpen, setStepsOpen] = useState(false);
  const freshness = useFreshness();
  const live = freshness.state === "live";

  const kernelRelease = status?.kernel_release;
  const wfbModuleSource = status?.wfb_module_source;
  const installStatus = status?.install_status;
  const installVersion = status?.install_version;
  const failedSteps = status?.failed_steps ?? [];

  // Only render the card when the agent has reported at least one of
  // the system-health fields. Older agents that omit all of them show
  // nothing rather than a card full of dashes.
  const hasAny =
    !!kernelRelease ||
    !!wfbModuleSource ||
    !!installStatus ||
    !!installVersion;
  if (!hasAny) return null;

  const wfbLabels: Record<WfbModuleSource, string> = {
    prebuilt: t("wfbPrebuilt"),
    dkms: t("wfbDkms"),
    none: t("wfbNone"),
  };
  const installLabels: Record<InstallStatus, string> = {
    ok: t("installOk"),
    degraded: t("installDegraded"),
    failed: t("installFailed"),
    unknown: t("installUnknown"),
  };

  const installUnhealthy =
    installStatus === "degraded" || installStatus === "failed";
  const hasSteps = failedSteps.length > 0;

  return (
    <div className={cn("border-t border-border-default px-3 py-2.5", !live && "opacity-60")}>
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <h4 className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
          {t("systemHealth")}
        </h4>
        {!live && (
          <span role="status" className="text-[10px] text-status-warning">
            {t("agentLastSeen", { ago: freshness.label })}
          </span>
        )}
      </div>

      <div className="space-y-2">
        {kernelRelease && (
          <div className="bg-bg-tertiary/50 rounded px-2.5 py-2">
            <p className="text-sm font-mono font-semibold text-text-primary tabular-nums truncate">
              {kernelRelease}
            </p>
            <p className="text-[10px] text-text-tertiary mt-0.5">{t("kernel")}</p>
          </div>
        )}

        {(wfbModuleSource || installStatus) && (
          <div className="flex flex-wrap items-center gap-2">
            {wfbModuleSource && (
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-text-tertiary">
                  {t("radioModule")}
                </span>
                <Badge variant={live ? WFB_VARIANT[wfbModuleSource] : "neutral"}>
                  {wfbLabels[wfbModuleSource]}
                </Badge>
              </div>
            )}
            {installStatus && (
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-text-tertiary">
                  {t("install")}
                </span>
                {installUnhealthy && hasSteps ? (
                  <Tooltip
                    multiline
                    content={
                      <div className="space-y-1">
                        <p className="text-xs font-semibold text-text-primary">
                          {t("failedSteps")}
                        </p>
                        <ul className="text-xs text-text-secondary list-disc pl-4 space-y-0.5">
                          {failedSteps.map((step) => (
                            <li key={step} className="font-mono break-words">
                              {step}
                            </li>
                          ))}
                        </ul>
                      </div>
                    }
                  >
                    <Badge variant={live ? INSTALL_VARIANT[installStatus] : "neutral"}>
                      {installLabels[installStatus]}
                    </Badge>
                  </Tooltip>
                ) : (
                  <Badge variant={live ? INSTALL_VARIANT[installStatus] : "neutral"}>
                    {installLabels[installStatus]}
                  </Badge>
                )}
              </div>
            )}
          </div>
        )}

        {installVersion && (
          <p className="text-[10px] text-text-tertiary">
            {t("installVersion")}:{" "}
            <span className="font-mono text-text-secondary">
              {installVersion}
            </span>
          </p>
        )}

        {installUnhealthy && hasSteps && (
          <div>
            <button
              type="button"
              onClick={() => setStepsOpen((o) => !o)}
              className="flex items-center gap-1 text-[10px] text-text-tertiary hover:text-text-secondary transition-colors"
            >
              {stepsOpen ? (
                <ChevronDown size={11} />
              ) : (
                <ChevronRight size={11} />
              )}
              {t("failedSteps")} ({failedSteps.length})
            </button>
            {stepsOpen && (
              <ul className="mt-1 pl-3 space-y-0.5">
                {failedSteps.map((step) => (
                  <li
                    key={step}
                    className="text-[11px] font-mono text-status-warning break-words"
                  >
                    {step}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
