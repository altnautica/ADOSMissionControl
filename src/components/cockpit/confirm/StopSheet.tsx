"use client";

/**
 * @module cockpit/confirm/StopSheet
 * @description The emergency stop's confirm on the flight screen, the same
 * on every cockpit: a sheet below the top bar beside the right column (where
 * STOP sits), titled "Emergency stop", the kill warning as its body, and one
 * hold button labelled with the spec's hold label. While it is held the
 * button counts down the time left. Cancel is the sheet's close button or
 * Escape; the gamepad button that opened it and Enter hold it too.
 *
 * @license GPL-3.0-only
 */

import type { RefObject } from "react";
import { X } from "lucide-react";

import layoutSpec from "@/lib/cockpit-spec/layout.json";
import { specString } from "@/lib/cockpit/spec-strings";
import type { ConfirmHold } from "./use-confirm-hold";
import { useFlightGrid } from "../flight/flight-context";
import { sheetPlacement } from "../flight/flight-sheet";

export function StopSheet({
  hold,
  holdMs,
  holdLeftMs,
  sheetRef,
  onCancel,
  staleLink = false,
}: {
  hold: ConfirmHold;
  holdMs: number;
  holdLeftMs: number;
  sheetRef: RefObject<HTMLDivElement | null>;
  onCancel: () => void;
  /** The link is stale, so the kill would be sent without an answer. */
  staleLink?: boolean;
}) {
  const grid = useFlightGrid();
  const hit = layoutSpec.touch_target.min * grid.scale;
  const { onPointerDown, onPointerUp, onPointerLeave, onPointerCancel } = hold.pointerHandlers;
  const title = specString("cockpit.estop");
  return (
    <div
      ref={sheetRef}
      role="alertdialog"
      aria-modal="false"
      aria-labelledby="stop-sheet-title"
      aria-describedby="stop-sheet-body"
      data-flight-confirm=""
      data-gesture="guarded"
      data-testid="stop-sheet"
      className="fs-sheet fs-stop-sheet"
      style={{ position: "absolute", ...sheetPlacement(grid, "right") }}
    >
      <header className="fs-sheet-head">
        <h2 id="stop-sheet-title">{title}</h2>
        <button
          type="button"
          className="fs-sheet-close"
          data-testid="stop-sheet-cancel"
          aria-label={specString("setup.action.cancel")}
          title={specString("setup.action.cancel")}
          style={{ width: hit, height: hit }}
          onClick={onCancel}
        >
          <X className="fs-ico-sm" aria-hidden="true" />
        </button>
      </header>
      <p id="stop-sheet-body" className="fs-stop-sheet-body">
        {specString("confirm.kill.message")}
      </p>
      {staleLink && (
        <p role="alert" className="fs-stop-sheet-stale" data-testid="stop-sheet-stale-link">
          {specString("confirm.stale_link")}
        </p>
      )}
      <button
        type="button"
        className="fs-stop-hold"
        data-hold-control="true"
        data-testid="stop-sheet-hold"
        data-holding={hold.holding ? "true" : "false"}
        style={{ minHeight: hit }}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerLeave}
        onPointerCancel={onPointerCancel}
        // Activation happens only through the hold; a click alone does nothing.
        onClick={(e) => e.preventDefault()}
      >
        <span
          aria-hidden="true"
          className="fs-stop-hold-fill"
          style={{
            width: hold.holding ? "100%" : "0%",
            transition: hold.holding ? `width ${holdMs}ms linear` : "width 200ms ease-out",
          }}
        />
        <span className="fs-stop-hold-label" role={hold.holding ? "status" : undefined}>
          {hold.holding
            ? specString("hold.keep_holding", { s: (holdLeftMs / 1000).toFixed(1) })
            : specString("stop.hold_label")}
        </span>
      </button>
    </div>
  );
}
