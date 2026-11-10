"use client";

/**
 * @module cockpit/layers/LayerLevelButton
 * @description The top-bar data-layer control: one tap cycles the level
 * Instruments → Full → Route → Off (the same as `O` and D-pad ↑/↓ with the
 * picker closed); the caret opens the per-layer switches ({@link LayerFlags}),
 * every layer flag as a checkbox plus the depth style and range. The switches
 * show what the open view draws. The Menu's Layers section shows the same
 * switches, and the cycle button alone when the bar moved it into the Menu.
 *
 * @license GPL-3.0-only
 */

import { useRef } from "react";
import { useFlightSheet, useSheetDismiss } from "@/components/cockpit/flight/flight-sheet";
import { useTranslations } from "next-intl";
import { Layers } from "lucide-react";

import { specString } from "@/lib/cockpit/spec-strings";

import { LAYER_DEFS, effectiveLayers } from "@/lib/cockpit/layers/layer-spec";
import { useCockpitView } from "@/lib/cockpit/views";
import { cn } from "@/lib/utils";
import {
  useCockpitLayersStore,
  useVehicleLayers,
  type DepthRange,
  type DepthStyle,
} from "@/stores/cockpit-layers-store";

const DEPTH_RANGES: readonly DepthRange[] = ["off", "2", "5"];
const DEPTH_STYLES: readonly DepthStyle[] = ["solid", "outline"];

export function LayerLevelButton({
  droneId,
  iconOnly = false,
  caret = true,
}: {
  droneId: string;
  iconOnly?: boolean;
  /** Offer the caret that opens the layer switches. */
  caret?: boolean;
}) {
  const t = useTranslations("cockpitLayers");
  const vl = useVehicleLayers(droneId);
  const cycleLevel = useCockpitLayersStore((s) => s.cycleLevel);
  const [open, setOpen] = useFlightSheet("layers");
  const menuRef = useRef<HTMLDivElement>(null);
  useSheetDismiss(menuRef, () => setOpen(false), "[data-sheet-trigger='layers']", open && caret);
  const level = t(`level.${vl.level}`);

  return (
    <div
      className="fs-layer relative flex items-center"
      data-testid="layer-level-button"
      data-item="layer_button"
      data-level={vl.level}
    >
      <button
        type="button"
        className="fs-btn fs-hit fs-layer-cycle"
        onClick={() => cycleLevel(droneId)}
        title={specString("cockpit.layers.next", { level })}
        aria-label={specString("cockpit.layers.next", { level })}
      >
        <Layers className="fs-ico" aria-hidden="true" />
        {!iconOnly && <span>{level}</span>}
      </button>
      {caret && (
        <button
          type="button"
          className="fs-btn fs-hit fs-layer-caret"
          data-sheet-trigger="layers"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={specString("cockpit.layers.flags")}
          title={specString("cockpit.layers.flags")}
          onClick={() => setOpen((o) => !o)}
        >
          <span aria-hidden="true">▾</span>
        </button>
      )}
      {caret && open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={specString("cockpit.layers.flags")}
          data-testid="layer-menu"
          className="fs-sheet absolute right-0 top-full z-40 mt-2 w-56 p-2"
        >
          <LayerFlags droneId={droneId} />
        </div>
      )}
    </div>
  );
}

/** Every layer flag as a checkbox, then the depth style and range. */
export function LayerFlags({ droneId }: { droneId: string }) {
  const t = useTranslations("cockpitLayers");
  const vl = useVehicleLayers(droneId);
  const view = useCockpitView(droneId);
  const setLayer = useCockpitLayersStore((s) => s.setLayer);
  const setDepth = useCockpitLayersStore((s) => s.setDepth);
  const on = effectiveLayers(vl.level, vl.flips, view);
  return (
    <div data-testid="layer-flags">
      {LAYER_DEFS.map((d) => (
        <label key={d.id} className="flex min-h-12 cursor-pointer items-center justify-between gap-2 px-1 text-xs">
          <span>{t(`layer.${d.id}`)}</span>
          <input
            type="checkbox"
            role="menuitemcheckbox"
            data-layer={d.id}
            aria-checked={on.has(d.id)}
            checked={on.has(d.id)}
            className="fs-focus"
            onChange={(e) => setLayer(droneId, d.id, e.target.checked)}
          />
        </label>
      ))}
      <div className="mt-2 border-t border-border-default pt-2 text-[11px] text-text-secondary">{t("depthOptions")}</div>
      <Segment
        values={DEPTH_STYLES}
        selected={vl.depthStyle}
        label={(v) => t(`depthStyle.${v}`)}
        onSelect={(v) => setDepth(droneId, v, vl.depthRange)}
      />
      <Segment
        values={DEPTH_RANGES}
        selected={vl.depthRange}
        label={(v) => t(`depthRange.${v}`)}
        onSelect={(v) => setDepth(droneId, vl.depthStyle, v)}
      />
    </div>
  );
}

function Segment<T extends string>({
  values,
  selected,
  label,
  onSelect,
}: {
  values: readonly T[];
  selected: T;
  label: (v: T) => string;
  onSelect: (v: T) => void;
}) {
  return (
    <div className="mt-1 flex gap-1">
      {values.map((v) => (
        <button
          key={v}
          type="button"
          className={cn(
            "fs-focus min-h-12 flex-1 rounded px-2 text-[11px]",
            v === selected ? "bg-accent-primary text-white" : "bg-white/5 text-text-secondary hover:bg-white/10",
          )}
          aria-pressed={v === selected}
          onClick={() => onSelect(v)}
        >
          {label(v)}
        </button>
      ))}
    </div>
  );
}
