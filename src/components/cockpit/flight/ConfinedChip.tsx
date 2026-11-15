"use client";

/**
 * @module cockpit/flight/ConfinedChip
 * @description The top bar's "Confined" chip while the pilot flies with the
 * confined-place profile (`pilot.place_class == "confined"`); nothing in an
 * open place. Its dot takes the route check's state (clear, not seen yet,
 * too tight), and tapping it opens the route-check report with the speed
 * cap the pilot holds near the clearance limit.
 * @license GPL-3.0-only
 */

import { useRef } from "react";
import { X } from "lucide-react";

import { useFlightGrid } from "@/components/cockpit/flight/flight-context";
import { FlightSheetPortal, sheetPlacement, useFlightSheet, useSheetDismiss } from "@/components/cockpit/flight/flight-sheet";
import { RouteCheckReport } from "@/components/cockpit/v2/RouteCheckReport";
import type { PilotState } from "@/lib/hud/cockpit-frames";
import { confinedChipText, routeCheckReport, speedCapLine } from "@/lib/hud/route-check";
import { specString } from "@/lib/cockpit/spec-strings";
import { usePilotState } from "@/lib/cockpit/use-pilot-state";

const DOT: Record<string, string> = {
  ok: "var(--fs-ok, #50fa7b)",
  warn: "var(--fs-warn, #f1fa8c)",
  critical: "var(--fs-crit, #ff5555)",
};

function RouteCheckSheet({ pilot, onClose }: { pilot: PilotState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useSheetDismiss(ref, onClose, "[data-sheet-trigger='route_check']");
  const place = sheetPlacement(useFlightGrid(), "left");
  const cap = speedCapLine(pilot.speedCap);
  return (
    <FlightSheetPortal>
      <div
        ref={ref}
        role="dialog"
        aria-label={specString("route_check.title")}
        data-testid="route-check-sheet"
        style={place}
        className="glass-panel pointer-events-auto absolute z-50 w-[min(360px,calc(100%-16px))] p-4 text-text-primary"
      >
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">{specString("chip.confined")}</h2>
          <button type="button" aria-label={specString("cockpit.close")} onClick={onClose} className="rounded p-1 hover:bg-white/10">
            <X size={14} aria-hidden="true" />
          </button>
        </div>
        <RouteCheckReport routeCheck={pilot.routeCheck} />
        {cap && (
          <p data-testid="route-check-cap" className="mt-2 text-xs text-status-warning">
            {cap}
          </p>
        )}
      </div>
    </FlightSheetPortal>
  );
}

export function ConfinedChip({ droneId }: { droneId: string }) {
  const { pilot } = usePilotState(droneId);
  const [open, setOpen] = useFlightSheet("route_check");
  const text = pilot ? confinedChipText(pilot) : null;
  if (!pilot || !text) return null;
  const report = routeCheckReport(pilot.routeCheck);
  return (
    <div className="stat" data-testid="confined-chip" data-route-check={report?.state ?? "none"}>
      <button
        type="button"
        data-sheet-trigger="route_check"
        className="navchip-btn fs-hit"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={report ? `${text}: ${report.line}` : text}
        title={report?.line ?? text}
        onClick={() => setOpen((v) => !v)}
      >
        {report && (
          <span
            aria-hidden="true"
            data-testid="confined-chip-dot"
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: DOT[report.severity] }}
          />
        )}
        <span className="v">{text}</span>
      </button>
      {open && <RouteCheckSheet pilot={pilot} onClose={() => setOpen(false)} />}
    </div>
  );
}
