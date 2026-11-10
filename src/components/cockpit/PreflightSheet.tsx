"use client";

/**
 * The pre-flight checklist on the flight screen: the shared spec checklist
 * (`flow.preflight.*`, the same items as every cockpit) for this drone.
 *
 * - `PreflightMenuRow`: the Menu's "Pre-flight n/m" row; a press closes the
 *   Menu and opens the checklist sheet.
 * - `PreflightSheet`: the checklist as a flight-screen sheet (one sheet at a
 *   time, below the top bar beside the left column), with one footer button:
 *   "Checks done" passes the first-arm gate once no item fails; while one
 *   fails it reads "Fix the failing checks" and stays disabled.
 *
 * A checklist evaluated for another aircraft never vouches for this one, so
 * its count renders as no data.
 *
 * @license GPL-3.0-only
 */

import { useRef } from "react";
import { Check, ClipboardCheck, TriangleAlert, X } from "lucide-react";
import { checklistReadyFor, useChecklistStore } from "@/stores/checklist-store";
import { firstArmAllowed, type PreflightState } from "@/lib/cockpit/preflight";
import { specString } from "@/lib/cockpit/spec-strings";
import { NO_DATA_GLYPH } from "@/lib/hud-draw";
import layoutSpec from "@/lib/cockpit-spec/layout.json";
import { useFlightGrid } from "./flight/flight-context";
import {
  FlightSheetPortal,
  sheetPlacement,
  useFlightSheet,
  useSheetDismiss,
} from "./flight/flight-sheet";

/** The flight-sheet id of the checklist. */
export const PREFLIGHT_SHEET = "preflight";

const STATE_COLOR: Record<PreflightState, string> = {
  pass: "var(--hud-good)",
  warn: "var(--hud-warn)",
  fail: "var(--hud-crit)",
};

function usePreflight(droneId: string) {
  const items = useChecklistStore((s) => (s.droneId === droneId ? s.preflight : null));
  const passed = useChecklistStore((s) => checklistReadyFor(s, droneId));
  const allowed = items !== null && firstArmAllowed(items);
  return { items, passed, allowed };
}

/** The Menu row: the checklist's count; a press opens the sheet. */
export function PreflightMenuRow({ droneId, onOpen }: { droneId: string; onOpen: () => void }) {
  const { items, passed, allowed } = usePreflight(droneId);
  const total = items?.length ?? 0;
  const ok = items?.filter((i) => i.state !== "fail").length ?? 0;
  const color = items === null
    ? "var(--hud-ink-2)"
    : !allowed
      ? "var(--hud-crit)"
      : passed
        ? "var(--hud-good)"
        : "var(--hud-warn)";
  return (
    <button
      type="button"
      data-testid="fs-menu-preflight"
      data-sheet-trigger={PREFLIGHT_SHEET}
      aria-haspopup="dialog"
      title={specString("flow.preflight.title")}
      onClick={onOpen}
    >
      <ClipboardCheck className="fs-ico" aria-hidden="true" style={{ color }} />
      {specString("cockpit.menu.preflight")}
      <span className="tabular-nums" data-testid="cockpit-preflight" style={{ marginLeft: "auto", color }}>
        {items === null ? NO_DATA_GLYPH : `${ok}/${total}`}
      </span>
    </button>
  );
}

/** The checklist sheet; mount once on the flight screen. */
export function PreflightSheet({ droneId }: { droneId: string }) {
  const [open, setOpen] = useFlightSheet(PREFLIGHT_SHEET);
  const grid = useFlightGrid();
  const ref = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);
  useSheetDismiss(ref, close, `[data-sheet-trigger='${PREFLIGHT_SHEET}']`, open);
  const { items, passed, allowed } = usePreflight(droneId);
  const passPreflight = useChecklistStore((s) => s.passPreflight);
  if (!open) return null;
  const title = specString("flow.preflight.title");
  const hit = layoutSpec.touch_target.min * grid.scale;

  return (
    <FlightSheetPortal>
      <div
        ref={ref}
        role="dialog"
        aria-label={title}
        data-testid="preflight-sheet"
        className="fs-sheet flex w-80 max-w-[90%] flex-col gap-2 overflow-hidden p-3"
        style={{ position: "absolute", ...sheetPlacement(grid, "left"), maxHeight: "70%" }}
      >
        <header className="fs-sheet-head">
          <h2>{title}</h2>
          <button
            type="button"
            className="fs-sheet-close"
            onClick={close}
            aria-label={specString("cockpit.close")}
            title={specString("cockpit.close")}
            style={{ width: hit, height: hit }}
          >
            <X className="fs-ico-sm" aria-hidden="true" />
          </button>
        </header>
        <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto text-[12px]" data-testid="preflight-items">
          {(items ?? []).map((item) => (
            <li key={item.id} data-state={item.state} className="flex items-center gap-2">
              {item.state === "pass" ? (
                <Check size={13} aria-hidden="true" style={{ color: STATE_COLOR.pass }} />
              ) : (
                <TriangleAlert size={13} aria-hidden="true" style={{ color: STATE_COLOR[item.state] }} />
              )}
              <span>{item.label}</span>
            </li>
          ))}
        </ul>
        <button
          type="button"
          data-testid="preflight-done"
          disabled={!allowed || passed}
          onClick={() => {
            if (passPreflight(droneId)) close();
          }}
          className="min-h-12 rounded-md px-3 text-xs font-semibold disabled:opacity-50"
          style={{ background: "color-mix(in srgb, var(--fs-text) 12%, transparent)", color: "var(--fs-text)", border: 0, cursor: allowed ? "pointer" : "default" }}
        >
          {allowed ? specString("flow.preflight.done") : specString("flow.preflight.fix")}
        </button>
      </div>
    </FlightSheetPortal>
  );
}
