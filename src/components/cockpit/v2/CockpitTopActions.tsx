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
import { usePadStatusStore } from "@/lib/input/pad-status";
import { specString } from "@/lib/cockpit/spec-strings";
import { useInputStore } from "@/stores/input-store";
import { Tour } from "@/components/config/ControlsSettingsCards";
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

/**
 * Controller status. Before any pad has reported it asks for a button press
 * (browsers expose a pad only after one). A pad whose layout is not standard
 * never streams sticks, so it reads "not supported". A pad's first connect
 * shows the three-card tour once per pad id, here as in Settings › Controls.
 */
export function ControllerChip() {
  const pad = usePadStatusStore();
  const padId = useInputStore((s) => s.gamepadId);
  if (!pad.seen && !pad.connected) {
    return (
      <span
        data-testid="cockpit-controller-chip"
        data-connected="false"
        className="glass-pill flex min-h-[32px] max-w-[220px] items-center gap-1.5 px-3 text-[11px] text-on-media/70"
      >
        <Gamepad2 size={13} aria-hidden="true" />
        <span className="truncate">{specString("controls.press_any_button")}</span>
      </span>
    );
  }
  const label = !pad.connected
    ? "Controller lost"
    : pad.needsCalibration
      ? "Controller layout not supported"
      : (pad.name ?? "Controller");
  return (
    <span className="relative">
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
      {pad.connected && pad.usable && padId && (
        <span className="absolute right-0 top-full z-50 mt-2 w-72">
          <Tour padId={padId} />
        </span>
      )}
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
