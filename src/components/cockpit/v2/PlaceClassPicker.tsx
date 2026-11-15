"use client";

/**
 * @module cockpit/v2/PlaceClassPicker
 * @description The place a flight flies in: Open, or Confined space (mines,
 * tunnels, rooms: a closer obstacle margin from walls and a slower speed near
 * the limit). The operator chooses it; the drone never does. The explain line
 * names the obstacle margin the pilot keeps for the chosen class: the route
 * check's margin while the pilot reports one, else the class floor over the
 * pilot's default margin ("—" for confined, whose floor needs the airframe's
 * propeller radius). Used by the Launch sheet and the planner.
 * @license GPL-3.0-only
 */

import { PLACE_CLASSES, type PlaceClass } from "@/lib/hud/cockpit-frames";
import { effectiveMarginM, placeClassExplain, placeClassLabel } from "@/lib/hud/route-check";
import { specString } from "@/lib/cockpit/spec-strings";
import { cn } from "@/lib/utils";

/** The margin the explain line names for `cls`: the pilot's own while it
 *  reports a route check for that class, else the class floor over the
 *  default margin. */
export function explainMarginM(cls: PlaceClass, reportedMarginM: number | null): number | null {
  return reportedMarginM ?? effectiveMarginM(cls, null, null);
}

export function PlaceClassPicker({
  value,
  onChange,
  reportedMarginM = null,
  disabled = false,
}: {
  value: PlaceClass;
  onChange: (cls: PlaceClass) => void;
  /** The pilot's effective margin for `value` (`route_check.margin_m`), when known. */
  reportedMarginM?: number | null;
  disabled?: boolean;
}) {
  return (
    <fieldset className="mb-3" data-testid="place-class-picker" data-value={value}>
      <legend className="mb-1 text-xs text-text-secondary">{specString("flow.launch.place_class")}</legend>
      <div className="flex gap-1" role="radiogroup" aria-label={specString("flow.launch.place_class")}>
        {PLACE_CLASSES.map((cls) => (
          <button
            key={cls}
            type="button"
            role="radio"
            aria-checked={value === cls}
            data-testid={`place-class-${cls}`}
            disabled={disabled}
            onClick={() => onChange(cls)}
            className={cn(
              "min-h-[40px] rounded px-3 text-xs font-semibold disabled:opacity-50",
              value === cls ? "bg-accent-primary/25 text-accent-primary" : "bg-white/5 text-text-secondary hover:bg-white/10",
            )}
          >
            {placeClassLabel(cls)}
          </button>
        ))}
      </div>
      <p data-testid="place-class-explain" className="mt-1 text-[11px] text-text-secondary">
        {placeClassExplain(value, explainMarginM(value, value === "confined" ? reportedMarginM : null))}
      </p>
    </fieldset>
  );
}
