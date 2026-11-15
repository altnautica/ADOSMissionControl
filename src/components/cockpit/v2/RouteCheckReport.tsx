"use client";

/**
 * @module cockpit/v2/RouteCheckReport
 * @description The confined profile's route check, as the pilot reports it
 * (`pilot.route_check`): the state line (route clear with the clearance it
 * keeps, not seen yet, or too tight with the tightest leg, its clearance and
 * the clearance it needs) and where the tightest checked point is. Shown on
 * the flight screen (the Confined chip's report and the Launch sheet) and in
 * the planner before the mission is flown. Text from the shared spec through
 * the shared `route-check` helper.
 * @license GPL-3.0-only
 */

import type { RouteCheck } from "@/lib/hud/cockpit-frames";
import { routeCheckReport, type RouteCheckReport as Report } from "@/lib/hud/route-check";
import { cn } from "@/lib/utils";

const TONE: Record<Report["severity"], string> = {
  ok: "text-status-success",
  warn: "text-status-warning",
  critical: "text-status-error",
};

export function RouteCheckReport({ routeCheck, className }: { routeCheck: RouteCheck | null | undefined; className?: string }) {
  const report = routeCheckReport(routeCheck);
  if (!report) return null;
  return (
    <div
      role={report.severity === "critical" ? "alert" : "status"}
      data-testid="route-check"
      data-state={report.state}
      data-severity={report.severity}
      className={cn("flex flex-col gap-0.5 text-xs", className)}
    >
      <span className="text-[11px] uppercase tracking-wide text-text-secondary">{report.title}</span>
      <span data-testid="route-check-line" className={cn("font-semibold", TONE[report.severity])}>
        {report.line}
      </span>
      {report.pinchAt && (
        <span data-testid="route-check-pinch" className="font-mono text-[11px] text-text-secondary">
          {report.pinchAt}
        </span>
      )}
    </div>
  );
}
