"use client";

/**
 * Pre-flight checklist + SYS_STATUS + prearm STATUSTEXT capture card.
 *
 * @module components/history/detail/tabs/overview/PreflightCard
 */

import { useTranslations } from "next-intl";
import { CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import type { PreflightSnapshot } from "@/lib/types";

export function PreflightCard({ preflight }: { preflight: PreflightSnapshot }) {
  const tq = useTranslations("history.preflightCard");
  const items = preflight.checklistItems ?? [];
  const passed = items.filter((i) => i.status === "pass").length;
  const skipped = items.filter((i) => i.status === "skipped").length;
  const failed = items.filter((i) => i.status === "fail").length;
  const pending = items.filter((i) => i.status === "pending").length;

  return (
    <div className="flex flex-col gap-2">
      {/* Summary */}
      <div className="flex items-center gap-3 text-[11px]">
        {preflight.checklistComplete ? (
          <span className="inline-flex items-center gap-1 text-status-success">
            <CheckCircle2 size={12} />
            {tq("checklistComplete")}
          </span>
        ) : items.length === 0 ? (
          <span className="text-text-tertiary">{tq("noChecklistCaptured")}</span>
        ) : (
          <span className="inline-flex items-center gap-1 text-status-warning">
            <AlertTriangle size={12} />
            {tq("checklistIncomplete")}
          </span>
        )}
        {items.length > 0 && (
          <span className="text-[10px] font-mono text-text-tertiary">
            {passed} pass · {skipped} skip · {failed} fail · {pending} pending
          </span>
        )}
      </div>

      {/* Failed items called out explicitly */}
      {failed > 0 && (
        <ul className="flex flex-col gap-0.5">
          {items
            .filter((i) => i.status === "fail")
            .map((i) => (
              <li key={i.id} className="flex items-center gap-1.5 text-[10px] text-status-error">
                <XCircle size={10} />
                {i.label}
                {i.displayValue && <span className="text-text-tertiary font-mono">· {i.displayValue}</span>}
              </li>
            ))}
        </ul>
      )}

      {/* Prearm STATUSTEXT failures (ArduPilot only) */}
      {preflight.prearmFailures && preflight.prearmFailures.length > 0 && (
        <div className="flex flex-col gap-0.5 mt-1">
          <span className="text-[10px] uppercase tracking-wider text-text-tertiary">{tq("fcPrearmWarnings")}</span>
          {preflight.prearmFailures.map((line, i) => (
            <span
              key={`${line}-${i}`}
              className="text-[10px] text-status-warning font-mono truncate"
              title={line}
            >
              {line}
            </span>
          ))}
        </div>
      )}

      {/* SYS_STATUS bitmasks */}
      {preflight.sysStatusHealth !== undefined && (
        <div className="flex flex-col gap-0.5 mt-1 text-[10px] font-mono text-text-tertiary">
          <span>Health: 0x{preflight.sysStatusHealth.toString(16).padStart(8, "0")}</span>
          {preflight.sysStatusEnabled !== undefined && (
            <span>Enabled: 0x{preflight.sysStatusEnabled.toString(16).padStart(8, "0")}</span>
          )}
          {preflight.sysStatusPresent !== undefined && (
            <span>Present: 0x{preflight.sysStatusPresent.toString(16).padStart(8, "0")}</span>
          )}
        </div>
      )}
    </div>
  );
}
