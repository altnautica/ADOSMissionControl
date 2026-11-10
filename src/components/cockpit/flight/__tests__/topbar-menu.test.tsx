/**
 * @license GPL-3.0-only
 *
 * The Menu's sections follow the shared spec's `menu.order`: the hidden
 * top-bar items (only those), View in the spec's cycle order, Cameras,
 * Layers (every layer flag as a checkbox), Pre-flight, Flight modes (opens
 * the Mode sheet), Controls, Extension panels, Set up aircraft (only while
 * the pilot reports setup is needed), Settings and Exit.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";

vi.mock("../CameraSheet", () => ({ CameraPanel: () => <div data-testid="camera-panel" /> }));
vi.mock("../../StickControlChip", () => ({ StickControlChip: () => <div data-testid="stick-control" /> }));
vi.mock("../../PreflightSheet", () => ({ PREFLIGHT_SHEET: "preflight", PreflightMenuRow: () => <div data-testid="preflight-row" />, PreflightSheet: () => null }));

import { LAYER_DEFS } from "@/lib/cockpit/layers/layer-spec";
import { parsePilotState } from "@/lib/hud/cockpit-frames";
import { demoPilotWire } from "@/mock/mock-pilot";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import { renderWithIntl } from "../../../../../tests/helpers/intl-wrapper";
import { FlightMenu } from "../FlightMenu";
import type { TopBarItem } from "../FlightTopBar";
import { useFlightSheetStore } from "../flight-sheet";

const DRONE = "topbar-menu";

function pinReadiness(readiness: Array<{ id: string; ok: boolean; severity: "block" | "warn"; msg: string }>) {
  const pilot = parsePilotState(demoPilotWire({ readiness }));
  if (!pilot) throw new Error("demo pilot wire did not parse");
  useNavStreamStore.getState().setPilot(DRONE, pilot, Date.now());
}

function mount(hidden: TopBarItem[] = []) {
  return renderWithIntl(<FlightMenu droneId={DRONE} hidden={new Set(hidden)} onClose={() => {}} />);
}

function sectionOrder(): string[] {
  return [...screen.getByTestId("fs-menu").querySelectorAll(":scope > [data-section]")].map(
    (el) => el.getAttribute("data-section")!,
  );
}

beforeEach(() => useFlightSheetStore.setState({ open: null }));

afterEach(() => {
  cleanup();
  useNavStreamStore.getState().clear(DRONE);
});

describe("flight Menu order", () => {
  it("lists its sections in the spec's menu.order, leaving out setup when not needed", () => {
    pinReadiness([]);
    mount(["controller", "nav_source"]);
    expect(sectionOrder()).toEqual([
      "overflow",
      "view",
      "cameras",
      "layers",
      "preflight",
      "modes",
      "controls",
      "extension_panels",
      "settings",
      "exit",
    ]);
  });

  it("offers Set up aircraft between the extension panels and the settings while setup is needed", () => {
    pinReadiness([{ id: "setup_needed", ok: false, severity: "block", msg: "Aircraft setup needed" }]);
    mount();
    expect(sectionOrder()).toEqual([
      "view",
      "cameras",
      "layers",
      "preflight",
      "modes",
      "controls",
      "extension_panels",
      "setup",
      "settings",
      "exit",
    ]);
    const setup = screen.getByTestId("fs-menu-setup");
    expect(setup.getAttribute("href")).toBe("/config/aircraft-setup");
    expect(setup.textContent).toBe("Set up aircraft");
  });

  it("lists only the hidden top-bar items, and no overflow section when none is hidden", () => {
    pinReadiness([]);
    mount(["controller", "nav_source"]);
    const overflow = screen.getByTestId("fs-menu-overflow");
    expect([...overflow.querySelectorAll(":scope > [data-item]")].map((el) => el.getAttribute("data-item"))).toEqual([
      "controller",
      "nav_source",
    ]);
    cleanup();
    mount();
    expect(screen.queryByTestId("fs-menu-overflow")).toBeNull();
  });

  it("orders the views as the spec's cycle and labels sections from the spec", () => {
    pinReadiness([]);
    mount();
    const views = [...screen.getByTestId("fs-menu").querySelectorAll("[data-testid^='fs-view-']")].map((el) =>
      el.getAttribute("data-testid"),
    );
    expect(views).toEqual(["fs-view-pilot", "fs-view-map", "fs-view-split", "fs-view-vision"]);
    expect(screen.getByTestId("fs-menu-modes").textContent).toBe("Flight modes");
    expect(screen.getByTestId("fs-menu-extensions").textContent).toBe("Extension panels");
    expect(screen.getByTestId("fs-menu-settings").textContent).toBe("Settings");
    // Mission Control leaves the flight screen for the drone page's Overview.
    expect(screen.getByTestId("fs-exit").textContent).toBe("Exit to Overview");
  });

  it("lists every layer flag as a checkbox in the Layers section", () => {
    pinReadiness([]);
    mount();
    const boxes = screen.getByTestId("fs-menu-layers").querySelectorAll("input[type='checkbox']");
    expect([...boxes].map((b) => b.getAttribute("data-layer"))).toEqual(LAYER_DEFS.map((d) => d.id));
  });

  it("opens the Mode sheet from Flight modes", () => {
    pinReadiness([]);
    mount();
    fireEvent.click(screen.getByTestId("fs-menu-modes"));
    expect(useFlightSheetStore.getState().open).toBe("mode");
  });
});
