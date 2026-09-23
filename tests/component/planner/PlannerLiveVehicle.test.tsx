/**
 * Planner live-vehicle surfaces: a GPS report older than the staleness window
 * no longer shows as a live fix, and the guidance vectors disappear with a
 * stale position instead of staying drawn at the last one.
 * @license GPL-3.0-only
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const latest = vi.hoisted(() => ({ gps: undefined as unknown, position: undefined as unknown, navController: undefined as unknown }));
vi.mock("@/hooks/use-telemetry-latest", () => ({
  useTelemetryLatest: (field: "gps" | "position" | "navController") => latest[field],
}));
vi.mock("next/dynamic", () => ({
  default: () => (props: { positions: unknown }) => <div data-testid="vector">{JSON.stringify(props.positions)}</div>,
}));

import { PlannerGpsBadge, PlannerGuidanceVectors } from "@/components/planner/PlannerLiveVehicle";
import { useClockStore } from "@/stores/clock-store";
import { useSettingsStore } from "@/stores/settings-store";

beforeEach(() => {
  useClockStore.setState({ now: Date.now() });
  useSettingsStore.setState({ guidanceHdgEnabled: true, guidanceTrackWpEnabled: false, guidanceTgtHdgEnabled: false });
});
afterEach(() => {
  cleanup();
  latest.gps = latest.position = latest.navController = undefined;
});

describe("PlannerGpsBadge", () => {
  it("shows a fresh 3D fix", () => {
    latest.gps = { timestamp: Date.now(), fixType: 3, satellites: 14 };
    render(<PlannerGpsBadge />);
    expect(screen.getByText("3D Fix | 14 SAT")).toBeInTheDocument();
  });

  it("drops a fix report that stopped updating", () => {
    latest.gps = { timestamp: Date.now() - 30_000, fixType: 3, satellites: 14 };
    render(<PlannerGpsBadge />);
    expect(screen.getByText("GPS -- | -- SAT")).toBeInTheDocument();
  });
});

describe("PlannerGuidanceVectors", () => {
  it("draws the heading vector from a fresh position", () => {
    latest.position = { timestamp: Date.now(), lat: 12.97, lon: 77.59, heading: 90 };
    render(<PlannerGuidanceVectors />);
    expect(screen.getAllByTestId("vector")).toHaveLength(1);
  });

  it("hides the vectors once the position is stale", () => {
    latest.position = { timestamp: Date.now() - 30_000, lat: 12.97, lon: 77.59, heading: 90 };
    render(<PlannerGuidanceVectors />);
    expect(screen.queryAllByTestId("vector")).toHaveLength(0);
  });
});
