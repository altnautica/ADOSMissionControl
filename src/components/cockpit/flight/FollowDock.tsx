"use client";

/**
 * @module cockpit/flight/FollowDock
 * @description Following-mode chrome in the follow strip (cockpit spec
 * `layout.json` zone `follow_strip`): directly under the top bar, spanning
 * between the left and right columns, so it never covers the centre or a
 * column. It holds the follow controls and a one-line range readout; the
 * bottom row owns the height above the ground, so the strip shows none.
 * Tapping the readout opens the full range panel as a flight-screen sheet
 * dropping from the strip; tapping again, Escape or a press outside closes it.
 *
 * @license GPL-3.0-only
 */

import { useCallback, useRef } from "react";
import { useTranslations } from "next-intl";

import { FollowRail } from "../FollowRail";
import { FollowRangePanel } from "../FollowRangePanel";
import { useFlightGrid } from "./flight-context";
import { rectStyle } from "./flight-grid";
import { FlightSheetPortal, useFlightSheet, useSheetDismiss } from "./flight-sheet";

const SHEET_ID = "follow-range";
const TRIGGER = "[data-follow-range-trigger]";
/** Space between the strip and the sheet below it. */
const SHEET_GAP_PX = 8;

export function FollowDock({ droneId }: { droneId: string }) {
  const t = useTranslations("flightScreen.follow");
  const grid = useFlightGrid();
  const rect = grid.zones.follow_strip;
  const [open, setOpen] = useFlightSheet(SHEET_ID);
  const sheetRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), [setOpen]);
  useSheetDismiss(sheetRef, close, TRIGGER, open && !!rect);
  if (!rect) return null;
  return (
    <>
      <div className="fs-panel fs-follow" data-zone="follow_strip" style={rectStyle(rect)}>
        <FollowRail droneId={droneId} withRec={!grid.zones.right_column} />
        <button
          type="button"
          className="fs-follow-range"
          data-follow-range-trigger=""
          aria-expanded={open}
          aria-label={t("rangeDetail")}
          title={t("rangeDetail")}
          onClick={() => setOpen((o) => !o)}
        >
          <FollowRangePanel droneId={droneId} variant="line" />
        </button>
      </div>
      {open && (
        <FlightSheetPortal>
          <div
            className="fs-follow-sheet-slot"
            style={{ position: "absolute", left: rect.x, width: rect.w, top: rect.y + rect.h + SHEET_GAP_PX }}
          >
            <div ref={sheetRef} className="fs-sheet fs-follow-sheet" role="dialog" aria-label={t("rangeDetail")} data-testid="follow-range-sheet">
              <FollowRangePanel droneId={droneId} variant="detail" />
            </div>
          </div>
        </FlightSheetPortal>
      )}
    </>
  );
}
