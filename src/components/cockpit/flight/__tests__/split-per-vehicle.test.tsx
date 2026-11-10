/**
 * @license GPL-3.0-only
 *
 * The Split divider is kept per vehicle in the view store: a drag moves it
 * live and stores it on release, the stored ratio survives the flight screen
 * closing and reopening, and another vehicle keeps its own.
 */

import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { useRef } from "react";

import { renderWithIntl } from "../../../../../tests/helpers/intl-wrapper";
import { SPLIT_DIVIDER, useCockpitViewStore } from "@/lib/cockpit/views";
import { FlightFrame, FlightMapFrame } from "../FlightFrame";

const A = "split-a";
const B = "split-b";

function Screen({ droneId }: { droneId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <FlightFrame
      droneId={droneId}
      containerRef={ref}
      size={{ width: 1280, height: 800, widthClass: "expanded" }}
      view="split"
      sidePanel={false}
      density="standard"
    >
      <FlightMapFrame main={false}>{null}</FlightMapFrame>
    </FlightFrame>
  );
}

function ratio(): number {
  return Number(screen.getByTestId("split-divider").getAttribute("data-ratio"));
}

afterEach(() => {
  cleanup();
  useCockpitViewStore.setState({ splitByDrone: {} });
});

describe("split divider per vehicle", () => {
  it("previews a drag live, stores it on release, and keeps it across a remount", () => {
    const { unmount } = renderWithIntl(<Screen droneId={A} />);
    expect(ratio()).toBe(SPLIT_DIVIDER.default);
    const sep = screen.getByTestId("split-divider");
    fireEvent.pointerDown(sep, { clientX: 640, pointerId: 1 });
    fireEvent.pointerMove(sep, { clientX: 500, pointerId: 1 });
    const live = ratio();
    expect(live).toBeLessThan(SPLIT_DIVIDER.default);
    // Nothing is stored mid-drag.
    expect(useCockpitViewStore.getState().splitByDrone[A]).toBeUndefined();
    fireEvent.pointerUp(sep, { clientX: 500, pointerId: 1 });
    expect(useCockpitViewStore.getState().splitByDrone[A]).toBeCloseTo(live, 5);
    expect(ratio()).toBeCloseTo(live, 5);

    unmount();
    renderWithIntl(<Screen droneId={A} />);
    expect(ratio()).toBeCloseTo(live, 5);
  });

  it("keeps each vehicle's own ratio", () => {
    act(() => useCockpitViewStore.getState().setSplit(A, SPLIT_DIVIDER.min));
    const { unmount } = renderWithIntl(<Screen droneId={B} />);
    expect(ratio()).toBe(SPLIT_DIVIDER.default);
    unmount();
    renderWithIntl(<Screen droneId={A} />);
    expect(ratio()).toBe(SPLIT_DIVIDER.min);
  });

  it("stores a keyboard move at once, and a cancelled drag stores nothing", () => {
    renderWithIntl(<Screen droneId={A} />);
    const sep = screen.getByTestId("split-divider");
    fireEvent.keyDown(sep, { key: "End" });
    expect(useCockpitViewStore.getState().splitByDrone[A]).toBe(SPLIT_DIVIDER.max);
    fireEvent.pointerDown(sep, { clientX: 640, pointerId: 2 });
    fireEvent.pointerMove(sep, { clientX: 400, pointerId: 2 });
    fireEvent.pointerCancel(sep, { clientX: 400, pointerId: 2 });
    expect(useCockpitViewStore.getState().splitByDrone[A]).toBe(SPLIT_DIVIDER.max);
    expect(ratio()).toBe(SPLIT_DIVIDER.max);
  });
});
