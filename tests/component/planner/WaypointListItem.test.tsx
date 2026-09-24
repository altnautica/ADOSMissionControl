/**
 * The waypoint row labels a relative altitude as above home and shows the real
 * ground clearance under the waypoint, coloured by that clearance.
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import type { Waypoint } from "@/lib/types";

vi.mock("@/stores/drone-manager", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores/drone-manager")>();
  const state = {
    drones: new Map(),
    selectedDroneId: null,
    getSelectedProtocol: () => null,
    getSelectedDrone: () => null,
  };
  const useDroneManager = (sel: (s: typeof state) => unknown) => sel(state);
  useDroneManager.getState = () => state;
  return { ...actual, useDroneManager };
});
vi.mock("@/lib/storage", () => ({
  indexedDBStorage: {
    storage: () => ({
      getItem: vi.fn().mockResolvedValue(null),
      setItem: vi.fn().mockResolvedValue(undefined),
      removeItem: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

import { WaypointListItem } from "@/components/planner/WaypointListItem";
import { useMissionStore } from "@/stores/mission-store";
import { usePlannerStore } from "@/stores/planner-store";
import { renderWithIntl } from "../../helpers/intl-wrapper";

const noop = () => {};

/** Launch point on 100 m ground. */
const HOME: Waypoint = { id: "home", lat: 12.97, lon: 77.59, alt: 0, command: "TAKEOFF", groundElevation: 100 };

function renderRow(waypoint: Waypoint) {
  useMissionStore.setState({ waypoints: [HOME, waypoint] });
  return renderWithIntl(
    <WaypointListItem
      waypoint={waypoint} index={1} expanded={false} selected={false}
      onExpand={noop} onSelect={noop} onUpdate={noop} onRemove={noop}
      onDragStart={noop} onDragOver={noop} onDragEnd={noop} onDrop={noop} dragOver={false}
    />,
  );
}

beforeEach(() => {
  cleanup();
  usePlannerStore.setState({ defaultFrame: "relative" });
});

describe("WaypointListItem altitude labels", () => {
  it("badges a relative altitude as above home, not above ground", () => {
    renderRow({ id: "w", lat: 12.98, lon: 77.6, alt: 50 });
    expect(screen.getByText("REL")).toBeTruthy();
    expect(screen.queryByText("AGL")).toBeNull();
  });

  it("shows the real clearance over a ridge higher than home, in the error colour", () => {
    // 50 m above a 100 m home is 150 m MSL: 30 m below the 180 m ridge.
    renderRow({ id: "w", lat: 12.98, lon: 77.6, alt: 50, groundElevation: 180 });
    const chip = screen.getByText("-30m AGL (ground: 180m)");
    expect(chip.className).toContain("text-status-error");
  });

  it("measures an absolute (MSL) altitude against the ground below it", () => {
    renderRow({ id: "w", lat: 12.98, lon: 77.6, alt: 500, frame: "absolute", groundElevation: 180 });
    expect(screen.getByText("MSL")).toBeTruthy();
    const chip = screen.getByText("320m AGL (ground: 180m)");
    expect(chip.className).toContain("text-status-success");
  });
});
