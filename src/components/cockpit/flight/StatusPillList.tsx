"use client";

/**
 * @module cockpit/flight/StatusPillList
 * @description The status pill's alert list: a sheet at the flight screen's
 * root, below the top bar beside the left column like every sheet, so the
 * top bar's box never clips it and every row stays readable and tappable.
 * Each row shows the alert text, its severity icon and the source it comes
 * from.
 *
 * @license GPL-3.0-only
 */

import type { RefObject } from "react";
import { CircleCheck, OctagonAlert, TriangleAlert } from "lucide-react";

import { specString } from "@/lib/cockpit/spec-strings";
import type { PillAlert, PillSource } from "@/lib/hud/status-pill";
import { useFlightGrid } from "./flight-context";
import { FlightSheetPortal, sheetPlacement } from "./flight-sheet";

export const PILL_ICON = { ok: CircleCheck, warning: TriangleAlert, critical: OctagonAlert } as const;
export const PILL_COLOR = { ok: "var(--fs-ok)", warning: "var(--fs-warn)", critical: "var(--fs-crit)" } as const;

/** Spec key naming each pill source in the list. */
export function pillSourceLabel(source: PillSource): string {
  return specString(`cockpit.status.source.${source}`);
}

export function StatusPillList({
  alerts,
  listRef,
}: {
  alerts: readonly PillAlert[];
  listRef: RefObject<HTMLDivElement | null>;
}) {
  const grid = useFlightGrid();
  return (
    <FlightSheetPortal>
      <div
        ref={listRef}
        role="dialog"
        aria-label={specString("cockpit.menu.status")}
        className="fs-sheet fs-pill-list"
        data-testid="status-pill-list"
        style={{ position: "absolute", ...sheetPlacement(grid, "left") }}
      >
        {alerts.length === 0 ? (
          <p className="fs-sheet-empty">{specString("cockpit.status.ok")}</p>
        ) : (
          <ul>
            {alerts.map((a) => {
              const Icon = PILL_ICON[a.severity];
              return (
                <li key={a.id} data-severity={a.severity}>
                  <Icon className="fs-ico" style={{ color: PILL_COLOR[a.severity] }} aria-hidden="true" />
                  <span className="fs-pill-item">{a.text}</span>
                  <span className="fs-pill-src">{pillSourceLabel(a.source)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </FlightSheetPortal>
  );
}
