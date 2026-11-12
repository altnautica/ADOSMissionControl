/**
 * @license GPL-3.0-only
 *
 * The flight screen's container takes programmatic focus but is not a Tab
 * stop of its own (it shows nothing to focus), and it mounts the one Fly Here
 * dialog for every map pane.
 */

import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, screen } from "@testing-library/react";
import { useRef } from "react";

import { renderWithIntl } from "../../../../../tests/helpers/intl-wrapper";
import { useGuidedStore } from "@/stores/guided-store";
import { useDroneManager } from "@/stores/drone-manager";
import { FlightFrame } from "../FlightFrame";

function Screen() {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <FlightFrame
      droneId="d1"
      containerRef={ref}
      size={{ width: 1280, height: 800, widthClass: "expanded" }}
      view="pilot"
      sidePanel={false}
      density="standard"
    >
      {null}
    </FlightFrame>
  );
}

afterEach(() => {
  cleanup();
  useGuidedStore.setState({ confirmPending: null });
  useDroneManager.setState({ selectedDroneId: null });
});

describe("flight screen container", () => {
  it("is focusable but out of the Tab order", () => {
    renderWithIntl(<Screen />);
    expect(screen.getByTestId("flight-screen").getAttribute("tabindex")).toBe("-1");
  });

  it("hosts the Fly Here dialog", () => {
    useDroneManager.setState({ selectedDroneId: "d1" });
    renderWithIntl(<Screen />);
    act(() => useGuidedStore.getState().showConfirm({ droneId: "d1", lat: 1, lon: 2, screenX: 0, screenY: 0 }));
    expect(screen.getAllByTestId("fly-here-dialog")).toHaveLength(1);
  });
});
