"use client";

/**
 * @module cockpit/layers/LayerLevelButton
 * @description The top-bar data-layer control: one tap cycles the level
 * Full → Route → Off (the same as `O` and D-pad ↑/↓ with the picker closed);
 * the caret opens the per-layer switches, including the leased depth and
 * surfaces layers and the depth style and range.
 *
 * @license GPL-3.0-only
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Layers } from "lucide-react";

import { LAYER_DEFS, effectiveLayers } from "@/lib/cockpit/layers/layer-spec";
import { cn } from "@/lib/utils";
import {
  useCockpitLayersStore,
  vehicleLayers,
  type DepthRange,
  type DepthStyle,
} from "@/stores/cockpit-layers-store";

const DEPTH_RANGES: readonly DepthRange[] = ["off", "2", "5"];
const DEPTH_STYLES: readonly DepthStyle[] = ["solid", "outline"];

export function LayerLevelButton({ droneId }: { droneId: string }) {
  const t = useTranslations("cockpitLayers");
  const vl = useCockpitLayersStore((s) => vehicleLayers(s.byVehicle, droneId));
  const cycleLevel = useCockpitLayersStore((s) => s.cycleLevel);
  const setLayer = useCockpitLayersStore((s) => s.setLayer);
  const setDepth = useCockpitLayersStore((s) => s.setDepth);
  const [open, setOpen] = useState(false);
  const on = effectiveLayers(vl.level, vl.flips, "pilot");

  return (
    <div className="relative flex items-center" data-testid="layer-level-button">
      <button
        type="button"
        className="flex min-h-12 items-center gap-1.5 rounded-l-md px-2 text-xs font-semibold text-text-primary hover:bg-white/10"
        onClick={() => cycleLevel(droneId)}
        title={t("cycleHint")}
        aria-label={t("levelAria", { level: t(`level.${vl.level}`) })}
      >
        <Layers size={16} aria-hidden="true" />
        <span>{t(`level.${vl.level}`)}</span>
      </button>
      <button
        type="button"
        className="min-h-12 rounded-r-md px-1.5 text-xs text-text-secondary hover:bg-white/10"
        aria-expanded={open}
        aria-label={t("menuAria")}
        onClick={() => setOpen((o) => !o)}
      >
        ▾
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-40 mt-1 w-56 rounded-md border border-border-default bg-bg-primary/95 p-2 shadow-lg"
        >
          {LAYER_DEFS.filter((d) => d.id !== "hud").map((d) => (
            <label key={d.id} className="flex min-h-10 cursor-pointer items-center justify-between gap-2 px-1 text-xs">
              <span>{t(`layer.${d.id}`)}</span>
              <input
                type="checkbox"
                role="menuitemcheckbox"
                aria-checked={on.has(d.id)}
                checked={on.has(d.id)}
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
      )}
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
            "min-h-9 flex-1 rounded px-2 text-[11px]",
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
