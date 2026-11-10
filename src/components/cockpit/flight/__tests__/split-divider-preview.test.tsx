/**
 * @license GPL-3.0-only
 *
 * A Split drag's live preview never outlives the drag: losing the pointer
 * capture cancels it, the divider leaving the screen (a view change) drops
 * it, and another vehicle never inherits it.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { useRef } from "react";

import { renderWithIntl } from "../../../../../tests/helpers/intl-wrapper";
import { SPLIT_DIVIDER, useCockpitViewStore } from "@/lib/cockpit/views";
import { FlightFrame } from "../FlightFrame";
import { FlightMapFrame } from "../FlightVideoFrame";

const A = "preview-a";
const B = "preview-b";

function Screen({ droneId, split = true }: { droneId: string; split?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <FlightFrame
      droneId={droneId}
      containerRef={ref}
      size={{ width: 1280, height: 800, widthClass: "expanded" }}
      view={split ? "split" : "map"}
      sidePanel={false}
      density="standard"
    >
      <FlightMapFrame main={!split}>{null}</FlightMapFrame>
    </FlightFrame>
  );
}

function ratio(): number {
  return Number(screen.getByTestId("split-divider").getAttribute("data-ratio"));
}

function startDrag(): number {
  const sep = screen.getByTestId("split-divider");
  fireEvent.pointerDown(sep, { clientX: 640, pointerId: 1 });
  fireEvent.pointerMove(sep, { clientX: 450, pointerId: 1 });
  const live = ratio();
  expect(live).toBeLessThan(SPLIT_DIVIDER.default);
  return live;
}

afterEach(() => {
  cleanup();
  useCockpitViewStore.setState({ splitByDrone: {} });
});

describe("split drag preview", () => {
  it("cancels the preview when the pointer capture is lost", () => {
    renderWithIntl(<Screen droneId={A} />);
    startDrag();
    fireEvent(screen.getByTestId("split-divider"), new Event("lostpointercapture", { bubbles: true }));
    expect(ratio()).toBe(SPLIT_DIVIDER.default);
    expect(useCockpitViewStore.getState().splitByDrone[A]).toBeUndefined();
    // A later move without a new press does not resume the drag.
    fireEvent.pointerMove(screen.getByTestId("split-divider"), { clientX: 400, pointerId: 1 });
    expect(ratio()).toBe(SPLIT_DIVIDER.default);
  });

  it("drops the preview when the view changes mid-drag", () => {
    const { rerender } = renderWithIntl(<Screen droneId={A} />);
    startDrag();
    rerender(<Screen droneId={A} split={false} />);
    expect(screen.queryByTestId("split-divider")).toBeNull();
    rerender(<Screen droneId={A} />);
    expect(ratio()).toBe(SPLIT_DIVIDER.default);
    expect(useCockpitViewStore.getState().splitByDrone[A]).toBeUndefined();
  });

  it("never carries a drag preview to another vehicle", () => {
    useCockpitViewStore.getState().setSplit(B, SPLIT_DIVIDER.max);
    const { rerender } = renderWithIntl(<Screen droneId={A} />);
    startDrag();
    rerender(<Screen droneId={B} />);
    expect(ratio()).toBe(SPLIT_DIVIDER.max);
  });
});
