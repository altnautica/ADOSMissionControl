"use client";

/**
 * @module cockpit/v2/CockpitTopActions
 * @description The top bar's right-of-chip cluster (cockpit spec
 * `layout.json` top bar): the data-layer button, the view button (Pilot /
 * Map / Split / Vision; `V` or Triangle cycles), the controller status and,
 * while the nav feed arrives by the 2 Hz fallback poll, "Reduced update rate
 * (radio)".
 *
 * @license GPL-3.0-only
 */

import { Gamepad2, Radio } from "lucide-react";

import { LayerLevelButton } from "@/components/cockpit/layers/LayerLevelButton";
import { useCockpitView, useCockpitViewStore, viewDef } from "@/lib/cockpit/views";
import { usePadStatusStore } from "@/lib/input/gamepad-poller";
import { useNavStreamStore } from "@/stores/nav-stream-store";

function ViewButton({ droneId }: { droneId: string }) {
  const view = useCockpitView(droneId);
  const cycle = useCockpitViewStore((s) => s.cycleView);
  return (
    <button
      type="button"
      data-testid="cockpit-view-button"
      data-view={view}
      onClick={() => cycle(droneId)}
      title="Cockpit view (V)"
      className="glass-pill min-h-[32px] px-3 text-[11px] font-semibold uppercase tracking-wide text-on-media"
    >
      {viewDef(view).label}
    </button>
  );
}

function ControllerChip() {
  const pad = usePadStatusStore();
  if (!pad.seen && !pad.connected) return null;
  const label = !pad.connected
    ? "Controller lost"
    : pad.needsCalibration
      ? "Controller layout not standard: calibrate"
      : (pad.name ?? "Controller");
  return (
    <span
      data-testid="cockpit-controller-chip"
      data-connected={pad.connected}
      title={pad.name ?? undefined}
      className={`glass-pill flex min-h-[32px] max-w-[220px] items-center gap-1.5 px-3 text-[11px] ${
        pad.connected && pad.usable ? "text-on-media" : "text-status-warning"
      }`}
    >
      <Gamepad2 size={13} aria-hidden="true" />
      <span className="truncate">{label}</span>
    </span>
  );
}

function ReducedRateChip({ droneId }: { droneId: string }) {
  const polled = useNavStreamStore((s) => s.byDrone[droneId]?.transport === "poll");
  if (!polled) return null;
  return (
    <span
      role="status"
      data-testid="reduced-rate-chip"
      className="glass-pill flex min-h-[32px] items-center gap-1.5 px-3 text-[11px] text-status-warning"
    >
      <Radio size={13} aria-hidden="true" />
      Reduced update rate (radio)
    </span>
  );
}

export function CockpitTopActions({ droneId }: { droneId: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <LayerLevelButton droneId={droneId} />
      <ViewButton droneId={droneId} />
      <ControllerChip />
      <ReducedRateChip droneId={droneId} />
    </div>
  );
}
