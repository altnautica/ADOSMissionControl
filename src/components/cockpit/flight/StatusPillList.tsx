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

import { useState, type RefObject } from "react";

import { specString } from "@/lib/cockpit/spec-strings";
import tokens from "@/lib/cockpit-spec/tokens.json";
import { refusalText } from "@/lib/hud/refusal";
import type { PillAlert, PillSource } from "@/lib/hud/status-pill";
import { requestPilotAction } from "@/lib/input/pilot-stream";
import { useFlightGrid } from "./flight-context";
import { FlightSheetPortal, sheetPlacement } from "./flight-sheet";

/** The pill id of the pilot's `airframe_balance` readiness row. */
const AIRFRAME_BALANCE_ID = "pilot:airframe_balance";

/** "I rebalanced it" on the `airframe_balance` row: clears the connected
 *  flight controller's learned airframe record (`airframe_reset`), so the
 *  next lift-off finds the trim again. A refusal shows on the row. Offered
 *  only while the drone is known disarmed. */
function AirframeResetButton() {
  const [refused, setRefused] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reset = async () => {
    setBusy(true);
    const r = await requestPilotAction("airframe_reset", {});
    setBusy(false);
    setRefused(r.ok ? null : refusalText(r.err));
  };
  return (
    <>
      <button
        type="button"
        className="fs-hit min-h-[40px] rounded bg-white/10 px-3 text-xs font-semibold"
        data-testid="airframe-reset"
        disabled={busy}
        onClick={() => void reset()}
      >
        {specString("readiness.airframe_balance.reset")}
      </button>
      {refused && (
        <span className="fs-text-crit text-[11px]" data-testid="airframe-reset-refused">
          {refused}
        </span>
      )}
    </>
  );
}

export const PILL_COLOR = { ok: "var(--fs-ok)", warning: "var(--fs-warn)", critical: "var(--fs-crit)" } as const;

/** Each list item's glyph from the spec (`chrome.severity_icon`), drawn in its
 *  severity colour; an item that is neither warning nor critical is info. */
export const SEVERITY_GLYPH = {
  ok: tokens.chrome.severity_icon.info,
  warning: tokens.chrome.severity_icon.warning,
  critical: tokens.chrome.severity_icon.critical,
} as const;

/** Spec key naming each pill source in the list. */
export function pillSourceLabel(source: PillSource): string {
  return specString(`cockpit.status.source.${source}`);
}

export function StatusPillList({
  alerts,
  listRef,
  armed,
}: {
  alerts: readonly PillAlert[];
  listRef: RefObject<HTMLDivElement | null>;
  /** The drone's arm state as the pill reads it; null when unknown. */
  armed: boolean | null;
}) {
  const grid = useFlightGrid();
  return (
    <FlightSheetPortal>
      <div
        ref={listRef}
        role="dialog"
        aria-labelledby="status-pill-list-title"
        className="fs-sheet fs-pill-list"
        data-testid="status-pill-list"
        style={{ position: "absolute", ...sheetPlacement(grid, "left") }}
      >
        <p id="status-pill-list-title" className="fs-menu-h" data-testid="status-pill-list-title">
          {specString("cockpit.alerts.title")}
        </p>
        {alerts.length === 0 ? (
          <p className="fs-sheet-empty">{specString("cockpit.status.ok")}</p>
        ) : (
          <ul>
            {alerts.map((a) => {
              const glyph = SEVERITY_GLYPH[a.severity];
              return (
                <li key={a.id} data-severity={a.severity}>
                  <span
                    className="fs-ico fs-pill-glyph"
                    data-testid="status-pill-glyph"
                    style={{ color: PILL_COLOR[a.severity] }}
                    aria-hidden="true"
                  >
                    {glyph}
                  </span>
                  <span
                    className="fs-pill-item"
                    style={a.severity === "critical" ? { color: "var(--fs-text-crit)" } : undefined}
                  >
                    {a.text}
                  </span>
                  <span className="fs-pill-src">{pillSourceLabel(a.source)}</span>
                  {a.id === AIRFRAME_BALANCE_ID && armed === false && <AirframeResetButton />}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </FlightSheetPortal>
  );
}
