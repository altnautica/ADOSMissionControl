"use client";

/**
 * Compliance alert bell — shows a badge count of active alerts with a
 * dropdown list when clicked.
 *
 * Phase 27 — continuous compliance monitoring.
 *
 * @license GPL-3.0-only
 */

import { useMemo, useState, useRef, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Bell, AlertTriangle, XCircle, Info } from "lucide-react";
import { useOperatorProfileStore } from "@/stores/operator-profile-store";
import { useAircraftRegistryStore } from "@/stores/aircraft-registry-store";
import { useBatteryRegistryStore } from "@/stores/battery-registry-store";
import { useEquipmentRegistryStore } from "@/stores/equipment-registry-store";
import { runComplianceChecks, type ComplianceAlert } from "@/lib/compliance/monitor";

export function ComplianceAlertBell() {
  const t = useTranslations("history");
  const operator = useOperatorProfileStore((s) => s.profile);
  const aircraft = useAircraftRegistryStore((s) => s.aircraft);
  const batteries = useBatteryRegistryStore((s) => s.packs);
  const equipment = useEquipmentRegistryStore((s) => s.items);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const alerts = useMemo(
    () => runComplianceChecks(operator, aircraft, batteries, equipment),
    [operator, aircraft, batteries, equipment],
  );

  const errorCount = alerts.filter((a) => a.severity === "error").length;
  const warningCount = alerts.filter((a) => a.severity === "warning").length;
  const total = alerts.length;

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const bellColor =
    errorCount > 0
      ? "text-status-error"
      : warningCount > 0
        ? "text-status-warning"
        : "text-text-tertiary";

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`relative p-1 rounded hover:bg-bg-tertiary transition-colors ${bellColor}`}
        title={`${t("complianceAlerts")} (${total})`}
      >
        <Bell size={14} />
        {total > 0 && (
          <span
            className={`absolute -top-0.5 -right-0.5 text-[8px] font-bold rounded-full w-3.5 h-3.5 flex items-center justify-center ${
              errorCount > 0 ? "bg-status-error text-white" : "bg-status-warning text-black"
            }`}
          >
            {total > 9 ? "9+" : total}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-72 max-h-80 overflow-y-auto rounded-md border border-border-default bg-bg-secondary shadow-lg">
          <div className="px-3 py-2 border-b border-border-default">
            <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider">
              {t("complianceAlerts")} ({total})
            </span>
          </div>
          {alerts.length === 0 ? (
            <div className="px-3 py-4 text-center text-[10px] text-text-tertiary">
              {t("complianceAllPassed")}
            </div>
          ) : (
            <div className="flex flex-col">
              {alerts.map((alert) => (
                <AlertRow key={alert.id} alert={alert} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AlertRow({ alert }: { alert: ComplianceAlert }) {
  const Icon =
    alert.severity === "error"
      ? XCircle
      : alert.severity === "warning"
        ? AlertTriangle
        : Info;
  const color =
    alert.severity === "error"
      ? "text-status-error"
      : alert.severity === "warning"
        ? "text-status-warning"
        : "text-text-tertiary";

  return (
    <div className="flex items-start gap-2 px-3 py-2 border-b border-border-default last:border-0 hover:bg-bg-tertiary">
      <Icon size={12} className={`${color} shrink-0 mt-0.5`} />
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-[10px] font-semibold text-text-primary">{alert.title}</span>
        <span className="text-[9px] text-text-tertiary">{alert.message}</span>
      </div>
    </div>
  );
}
