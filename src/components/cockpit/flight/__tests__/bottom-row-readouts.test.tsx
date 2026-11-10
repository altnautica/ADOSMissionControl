/**
 * @license GPL-3.0-only
 *
 * The bottom row's readouts: a signed value that rounds to zero reads "0.0",
 * never "-0.0", and a stale pilot state leaves AGL at the no-data glyph,
 * dimmed, rather than any other source's height.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";

import { renderWithIntl } from "../../../../../tests/helpers/intl-wrapper";
import { BottomRow } from "../BottomRow";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import { NO_DATA_GLYPH } from "@/lib/hud-draw";

const DRONE = "row-readouts";

function position(over: { relativeAlt?: number; climbRate?: number } = {}): void {
  useTelemetryStore.getState().pushPosition({
    timestamp: Date.now(),
    lat: 12.9716,
    lon: 77.5946,
    alt: 980,
    relativeAlt: 60,
    groundSpeed: 4,
    climbRate: 0,
    ...over,
  });
}

function cell(key: string): HTMLElement {
  return screen.getByTestId(`fs-row-${key}`);
}

function value(key: string): string {
  return cell(key).querySelector(".fs-value")?.textContent ?? "";
}

afterEach(() => {
  cleanup();
  useTelemetryStore.getState().clear();
  useNavStreamStore.setState({ byDrone: {} });
});

describe("bottom row readouts", () => {
  it("reads -0.04 as 0.0, never -0.0", () => {
    position({ relativeAlt: -0.04, climbRate: -0.04 });
    renderWithIntl(<BottomRow droneId={DRONE} />);
    expect(value("vs")).toBe("0.0 m/s");
    expect(value("h")).toBe("0.0 m");
  });

  it("keeps the sign of a value that does not round to zero", () => {
    position({ climbRate: -1.26 });
    renderWithIntl(<BottomRow droneId={DRONE} />);
    expect(value("vs")).toBe("-1.3 m/s");
  });

  it("shows AGL as no data, dimmed, while the pilot state is stale", () => {
    position();
    useTelemetryStore.getState().pushTerrain({ timestamp: Date.now(), currentHeight: 3 } as never);
    useNavStreamStore.getState().setPilot(DRONE, { aglM: 60, aglSource: "home" } as never, Date.now() - 3000);
    renderWithIntl(<BottomRow droneId={DRONE} />);
    expect(value("agl")).toBe(NO_DATA_GLYPH);
    expect(cell("agl").getAttribute("data-stale")).toBe("true");
  });

  it("shows the FC's AGL, not dimmed, while the pilot state is fresh", () => {
    position();
    useTelemetryStore.getState().pushTerrain({ timestamp: Date.now(), currentHeight: 3 } as never);
    useNavStreamStore.getState().setPilot(DRONE, { aglM: 60, aglSource: "home" } as never);
    renderWithIntl(<BottomRow droneId={DRONE} />);
    expect(value("agl")).toBe("3.0 m");
    expect(cell("agl").getAttribute("data-stale")).toBeNull();
  });
});
