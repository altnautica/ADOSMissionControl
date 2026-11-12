/**
 * @license GPL-3.0-only
 *
 * The left column shows each built-in's icon with its short label under it
 * (`builtin.short.<id>`) at medium, expanded and TV, icon only at compact;
 * the full label stays the accessible name, and a TV label is at least the
 * spec's `label_min_px`.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";

import { renderWithIntl } from "../../../../../tests/helpers/intl-wrapper";
import layoutSpec from "@/lib/cockpit-spec/layout.json";
import { specBuiltin } from "@/lib/cockpit/spec-builtins";
import { specString } from "@/lib/cockpit/spec-strings";
import { widthClassFor } from "@/lib/cockpit/width-class";
import { useDroneStore } from "@/stores/drone-store";
import { forgetDrone, noteFcLandedState } from "@/lib/skills/flight-facts";
import { FlightGridContext } from "@/components/cockpit/flight/flight-context";
import { flightGrid } from "@/components/cockpit/flight/flight-grid";
import { LeftColumn } from "../LeftColumn";

const DRONE = "left-col-labels";

function mount(w: number, h: number) {
  const grid = flightGrid({ width: w, height: h, widthClass: widthClassFor(w, false) });
  renderWithIntl(
    <FlightGridContext.Provider value={grid}>
      <LeftColumn droneId={DRONE} />
    </FlightGridContext.Provider>,
  );
  return grid;
}

// A known disarm: an unknown arm state may be airborne and shows Land.
beforeEach(() => {
  useDroneStore.setState({ armState: "disarmed" } as never);
});

afterEach(() => {
  cleanup();
  useDroneStore.setState({ armState: "disarmed" } as never);
  forgetDrone(DRONE);
});

describe("left column labels", () => {
  it.each([
    [760, 480, "medium"],
    [1280, 800, "expanded"],
    [1920, 1080, "tv"],
  ] as const)("shows the short label under each icon at %ix%i (%s)", (w, h, cls) => {
    const grid = mount(w, h);
    expect(grid.cls).toBe(cls);
    const col = screen.getByTestId("left-column");
    expect(col.getAttribute("data-labels")).toBe("true");
    for (const id of ["takeoff", "rth", "pause"]) {
      const label = screen.getByTestId(`left-col-label-${id}`);
      expect(label.textContent).toBe(specString(`builtin.short.${id}`));
      // The icon sits before the label; the full label names the button.
      const button = label.closest("button")!;
      expect(button.firstElementChild?.tagName.toLowerCase()).toBe("svg");
      expect(button.getAttribute("aria-label")).toBe(specBuiltin(id).label);
    }
  });

  it("is icon only at compact", () => {
    const grid = mount(580, 360);
    expect(grid.cls).toBe("compact");
    const col = screen.getByTestId("left-column");
    expect(col.getAttribute("data-labels")).toBe("false");
    expect(col.querySelectorAll("[data-testid^='left-col-label-']")).toHaveLength(0);
    expect(col.textContent).toBe("");
    for (const id of ["takeoff", "rth", "pause"]) {
      expect(col.querySelector(`[aria-label='${specBuiltin(id).label}']`)).not.toBeNull();
    }
  });

  it("reads Land in the air", () => {
    useDroneStore.setState({ armState: "armed" } as never);
    // EXTENDED_SYS_STATE: MAV_LANDED_STATE_IN_AIR.
    noteFcLandedState(DRONE, 2);
    mount(1280, 800);
    expect(screen.getByTestId("left-col-label-land").textContent).toBe(specString("builtin.short.land"));
  });

  it("keeps a TV label at least label_min_px", () => {
    mount(1920, 1080);
    const min = layoutSpec.classes.tv.label_min_px;
    expect(min).toBe(16);
    for (const id of ["takeoff", "rth", "pause"]) {
      expect(parseFloat(screen.getByTestId(`left-col-label-${id}`).style.fontSize)).toBeGreaterThanOrEqual(min);
    }
  });
});
