/**
 * @license GPL-3.0-only
 *
 * On-screen sticks shown in this width class (`layout.json`
 * `on_screen_sticks.classes`) stand in for a controller: the pre-flight
 * controller item passes with the "or on-screen sticks" text, and the
 * detailed auto item passes. In a width class without the sticks, or with
 * them switched off, a missing controller still warns and fails.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as PilotStream from "@/lib/input/pilot-stream";

vi.mock("@/lib/input/pilot-stream", async (importOriginal) => ({
  ...(await importOriginal<typeof PilotStream>()),
  sendPilotInput: vi.fn(),
  sendPilotRelease: vi.fn(),
  sticksRouteToPilot: () => true,
}));

import { CockpitLayoutContext } from "@/hooks/use-cockpit-width-class";
import { evaluateAutoChecks } from "@/lib/checklist/auto-checks";
import { useOnScreenSticksShown } from "@/lib/cockpit/on-screen-sticks-shown";
import { preflightItems, type PreflightInputs } from "@/lib/cockpit/preflight";
import { specText } from "@/lib/hud/spec-text";
import type { CockpitWidthClass } from "@/lib/cockpit/width-class";
import { usePilotLinkStore } from "@/lib/input/pilot-stream";
import { usePadStatusStore } from "@/lib/input/pad-status";
import { useCockpitPrefsStore } from "@/stores/cockpit-prefs-store";
import { OnScreenSticks } from "../OnScreenSticks";

function renderSticks(widthClass: CockpitWidthClass) {
  return render(
    <CockpitLayoutContext.Provider value={{ width: 1280, height: 800, widthClass }}>
      <OnScreenSticks droneId="sticks-preflight" />
    </CockpitLayoutContext.Provider>,
  );
}

/** The checklist's controller items as the runner builds them, no pad connected. */
function controllerItems() {
  const onScreenSticks = useOnScreenSticksShown.getState().shown;
  const inputs: PreflightInputs = {
    readiness: [],
    prearm: [],
    checks: [],
    live: true,
    nav: null,
    controlMode: "ados",
    controller: { connected: false, name: null },
    onScreenSticks,
    storagePct: 40,
  };
  const auto = evaluateAutoChecks(
    {
      battery: undefined,
      knownCellCount: null,
      gps: undefined,
      ekf: undefined,
      sysStatus: undefined,
      missionOnVehicle: null,
      fenceOnVehicle: null,
      formatGpsFix: () => "",
      pilot: { readiness: [], controlMode: "ados" },
      controllerConnected: false,
      onScreenSticks,
    },
    Date.now(),
  );
  return { item: preflightItems(inputs).find((i) => i.id === "controller"), auto: auto.controller };
}

const OPTIONAL = "Controller connected (or on-screen sticks / skills only)";

beforeEach(() => {
  useCockpitPrefsStore.setState({ onScreenSticks: true });
  usePilotLinkStore.setState({ connected: true, controlMode: "ados" });
  usePadStatusStore.setState({ connected: false });
});

afterEach(() => cleanup());

describe("on-screen sticks in the pre-flight checklist", () => {
  it("pass the controller item while shown in this width class", () => {
    renderSticks("expanded");
    expect(screen.getByTestId("on-screen-stick-right")).toBeTruthy();
    const { item, auto } = controllerItems();
    expect(item).toEqual({ id: "controller", label: OPTIONAL, state: "pass" });
    expect(auto).toEqual({ status: "pass", displayValue: OPTIONAL });
  });

  it("leave a missing controller warning in a width class without the sticks", () => {
    renderSticks("medium");
    expect(screen.queryByTestId("on-screen-stick-right")).toBeNull();
    const { item, auto } = controllerItems();
    expect(item).toEqual({ id: "controller", label: specText("controls.no_controller"), state: "warn" });
    expect(auto.status).toBe("fail");
  });

  it("stop standing in once they hide", () => {
    const view = renderSticks("compact");
    expect(controllerItems().item?.state).toBe("pass");
    view.unmount();
    expect(controllerItems().item?.state).toBe("warn");
    useCockpitPrefsStore.setState({ onScreenSticks: false });
    renderSticks("compact");
    expect(controllerItems().auto.status).toBe("fail");
  });
});
