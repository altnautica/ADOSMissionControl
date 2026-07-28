"use client";

/**
 * @module command/swarm-view/SwarmFleetMap
 * @description Band four: where the fleet actually is, beside the table.
 *
 * The map is the second reading of the same facts, never a third source of
 * them: it draws position, heading and severity, all of which the table's
 * columns already state, and nothing else. C2 maps that accumulate overlays get
 * ignored outright, so the discipline here is subtractive.
 *
 * Selection is shared with the table. Dragging a rectangle over three drones
 * and pressing Return-to-launch is the gesture this band exists for, so the
 * marquee writes into the same slot set the action bar consumes rather than
 * owning a selection of its own.
 *
 * Leaflet touches `window` on import, so the body is loaded client-side only.
 *
 * @license GPL-3.0-only
 */

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import dynamic from "next/dynamic";
import { ChevronDown, ChevronRight, MapPin, SquareDashedMousePointer } from "lucide-react";

import { cn } from "@/lib/utils";
import type { FleetNodeEntry } from "@/hooks/use-fleet-nodes";
import type { SwarmBeaconRow } from "@/stores/swarm-beacon-store";
import { useSwarmSlotRows } from "./use-swarm-slot-rows";

const SwarmFleetMapInner = dynamic(() => import("./SwarmFleetMapInner"), {
  ssr: false,
});

export interface SwarmFleetMapProps {
  rows: readonly SwarmBeaconRow[];
  nodesBySlot: ReadonlyMap<number, FleetNodeEntry>;
  selected: ReadonlySet<number>;
  /** Replaces the selection with exactly these slots. */
  onSelectSlots: (slots: readonly number[]) => void;
}

export function SwarmFleetMap({
  rows,
  nodesBySlot,
  selected,
  onSelectSlots,
}: SwarmFleetMapProps) {
  const t = useTranslations("swarmView.map");
  const [open, setOpen] = useState(true);
  const [selectMode, setSelectMode] = useState(false);

  const slotRows = useSwarmSlotRows(rows, nodesBySlot);
  const positioned = useMemo(
    () => slotRows.filter((row) => row.beacon !== null),
    [slotRows],
  );

  return (
    <aside className="shrink-0 rounded-lg border border-border-default bg-bg-secondary xl:w-[420px]">
      <div className="flex items-center justify-between gap-2 border-b border-border-default px-3 py-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-text-secondary">
          <MapPin size={13} className="text-text-tertiary" />
          {t("title")}
          <span className="font-mono text-[10px] font-normal tabular-nums text-text-tertiary">
            {t("positioned", { count: positioned.length })}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setSelectMode((v) => !v)}
            aria-pressed={selectMode}
            title={t("selectModeHint")}
            className={cn(
              "flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary",
              selectMode
                ? "bg-accent-primary/15 text-accent-primary"
                : "text-text-tertiary hover:text-text-primary",
            )}
          >
            <SquareDashedMousePointer size={13} />
            {t("selectMode")}
          </button>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-text-tertiary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
          >
            {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            {open ? t("collapse") : t("expand")}
          </button>
        </div>
      </div>

      {open && (
        <div className="p-3">
          {positioned.length === 0 ? (
            <p className="py-10 text-center text-xs text-text-tertiary">
              {t("noPositions")}
            </p>
          ) : (
            <>
              <div className="h-[320px] overflow-hidden rounded border border-border-default">
                <SwarmFleetMapInner
                  rows={positioned}
                  selected={selected}
                  onSelectSlots={onSelectSlots}
                  selectMode={selectMode}
                />
              </div>
              <p className="mt-2 text-[10px] leading-relaxed text-text-tertiary">
                {selectMode ? t("marqueeHint") : t("panHint")}
              </p>
            </>
          )}
        </div>
      )}
    </aside>
  );
}
