"use client";

/**
 * @module cockpit/flight/ControllerCell
 * @description The top bar's controller cell: the pad's state in the shared
 * spec's words. It subscribes only to the pad status.
 *
 * @license GPL-3.0-only
 */

import { Gamepad2 } from "lucide-react";

import { specString } from "@/lib/cockpit/spec-strings";
import { shortPadName, usePadStatusStore } from "@/lib/input/pad-status";

/**
 * The controller's state in the shared spec's words. Browsers expose a pad
 * only after its first button press: before any pad has reported this
 * session the cell reads "no controller"; once one has and is gone again it
 * asks for a press. A connected pad reads as a pad, or as not standard when
 * its layout never streams sticks.
 */
export function ControllerCell() {
  const pad = usePadStatusStore();
  const name = shortPadName(pad.name);
  const label = name ? specString("cockpit.controller.named", { name }) : specString("cockpit.controller");
  const state: "none" | "seen" | "connected" | "not_standard" = !pad.connected
    ? pad.seen
      ? "seen"
      : "none"
    : pad.needsCalibration
      ? "not_standard"
      : "connected";
  const text =
    state === "none"
      ? specString("controls.no_controller")
      : state === "seen"
        ? specString("controls.press_any_button")
        : state === "not_standard"
          ? specString("controls.pad.not_standard")
          : specString("controls.pad.connected", { battery: "" });
  return (
    <div
      className={`fs-cell${state === "not_standard" ? " fs-warn" : ""}`}
      data-testid="cockpit-controller-chip"
      data-item="controller"
      data-connected={pad.connected}
      data-pad={state}
      aria-label={`${label}: ${text}`}
      title={label}
    >
      <Gamepad2 className="fs-ico" aria-hidden="true" />
      <span className="fs-sub fs-trunc">{text}</span>
    </div>
  );
}
