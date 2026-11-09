"use client";

/**
 * @module cockpit/flight/FollowDock
 * @description Following-mode chrome, docked in its own zone directly above
 * the bottom row so it never covers the centre or a column: the follow
 * controls and the one-line range readout. Tapping the readout opens the full
 * range panel as a sheet rising from the dock; tapping again closes it.
 *
 * @license GPL-3.0-only
 */

import { useState } from "react";
import { useTranslations } from "next-intl";

import { FollowRail } from "../FollowRail";
import { FollowRangePanel } from "../FollowRangePanel";
import { useFlightGrid } from "./flight-context";
import { rectStyle } from "./flight-grid";

export function FollowDock({ droneId }: { droneId: string }) {
  const t = useTranslations("flightScreen.follow");
  const grid = useFlightGrid();
  const rect = grid.zones.follow_dock;
  const [detail, setDetail] = useState(false);
  if (!rect) return null;
  return (
    <div className="fs-panel fs-follow" data-zone="follow_dock" style={rectStyle(rect)}>
      <FollowRail droneId={droneId} withRec={!grid.zones.right_column} />
      <button
        type="button"
        className="fs-follow-range"
        aria-expanded={detail}
        aria-label={t("rangeDetail")}
        title={t("rangeDetail")}
        onClick={() => setDetail((d) => !d)}
      >
        <FollowRangePanel droneId={droneId} variant="line" />
      </button>
      {detail && (
        <div className="fs-sheet fs-follow-sheet" data-testid="follow-range-sheet">
          <FollowRangePanel droneId={droneId} variant="detail" />
        </div>
      )}
    </div>
  );
}
