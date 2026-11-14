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
 * On a strip too narrow for the quick settings, the rail's More button opens
 * them as a sheet in the same place. While follow-me holds for the operator,
 * the waiting prompt drops from the strip in the range sheet's place, and
 * the critical alerts stack below it rather than over its title.
 *
 * @license GPL-3.0-only
 */

import { useCallback, useLayoutEffect, useRef } from "react";

import { specString } from "@/lib/cockpit/spec-strings";
import { useFollowingMode } from "@/hooks/use-following-mode";

import { FOLLOW_SETTINGS_TRIGGER, FollowRail } from "../FollowRail";
import { FollowRangePanel } from "../FollowRangePanel";
import { FollowQuickSettings } from "../FollowSettingToggle";
import { FollowAwaitPrompt } from "./FollowAwaitPrompt";
import { useFlightGrid } from "./flight-context";
import { rectStyle } from "./flight-grid";
import { FlightSheetPortal, useFlightSheet, useSheetDismiss } from "./flight-sheet";
import { useFollowPromptEdge } from "./follow-prompt-edge";

const SHEET_ID = "follow-range";
const SETTINGS_SHEET_ID = "follow-settings";
const TRIGGER = "[data-follow-range-trigger]";
/** Space between the strip and the sheet below it. */
const SHEET_GAP_PX = 8;

export function FollowDock({ droneId }: { droneId: string }) {
  const rangeLabel = specString("follow.range");
  const grid = useFlightGrid();
  const rect = grid.zones.follow_strip;
  const [open, setOpen] = useFlightSheet(SHEET_ID);
  const [settingsOpen, setSettingsOpen] = useFlightSheet(SETTINGS_SHEET_ID);
  const sheetRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const { follow, stale } = useFollowingMode(droneId);
  const awaiting = !stale && follow?.phase === "holding-await-operator";
  const close = useCallback(() => setOpen(false), [setOpen]);
  const closeSettings = useCallback(() => setSettingsOpen(false), [setSettingsOpen]);
  useSheetDismiss(sheetRef, close, TRIGGER, open && !!rect);
  useSheetDismiss(settingsRef, closeSettings, `[${FOLLOW_SETTINGS_TRIGGER}]`, settingsOpen && !!rect);

  // While the prompt shows, report where it ends so the alerts start below it.
  const slotTop = rect ? rect.y + rect.h + SHEET_GAP_PX : null;
  useLayoutEffect(() => {
    const slot = slotRef.current;
    if (!awaiting || slotTop === null || !slot) return;
    const report = () => useFollowPromptEdge.setState({ bottomPx: slotTop + slot.offsetHeight });
    report();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(report);
    ro?.observe(slot);
    return () => {
      ro?.disconnect();
      useFollowPromptEdge.setState({ bottomPx: null });
    };
  }, [awaiting, slotTop]);

  if (!rect || slotTop === null) return null;
  return (
    <>
      <div className="fs-panel fs-follow" data-zone="follow_strip" style={rectStyle(rect)}>
        <FollowRail
          droneId={droneId}
          withRec={!grid.zones.right_column}
          stripW={rect.w}
          settingsOpen={settingsOpen}
          onToggleSettings={() => setSettingsOpen((o) => !o)}
        />
        <button
          type="button"
          className="fs-follow-range"
          data-follow-range-trigger=""
          aria-expanded={open}
          aria-label={rangeLabel}
          title={rangeLabel}
          onClick={() => setOpen((o) => !o)}
        >
          <FollowRangePanel droneId={droneId} variant="line" />
        </button>
      </div>
      {(awaiting || open || settingsOpen) && (
        <FlightSheetPortal>
          <div
            ref={slotRef}
            className="fs-follow-sheet-slot"
            style={{ position: "absolute", left: rect.x, width: rect.w, top: slotTop }}
          >
            {settingsOpen && (
              <div
                ref={settingsRef}
                className="fs-sheet fs-follow-sheet fs-follow-settings"
                role="dialog"
                aria-label={specString("follow.more_controls")}
                data-testid="follow-settings-sheet"
              >
                <FollowQuickSettings droneId={droneId} />
              </div>
            )}
            {awaiting ? (
              <FollowAwaitPrompt droneId={droneId} />
            ) : (
              open && (
                <div ref={sheetRef} className="fs-sheet fs-follow-sheet" role="dialog" aria-label={rangeLabel} data-testid="follow-range-sheet">
                  <FollowRangePanel droneId={droneId} variant="detail" />
                </div>
              )
            )}
          </div>
        </FlightSheetPortal>
      )}
    </>
  );
}
