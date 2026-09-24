import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (k: string) => k,
}));

// Keep the drone-manager mock light so the test never pulls the protocol stack.
// No connected protocol → firmware is undefined → the item-count advisory falls
// back to the default FC ceiling.
vi.mock("@/stores/drone-manager", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/stores/drone-manager")>()),
  useDroneManager: (sel: (s: unknown) => unknown) =>
    sel({ drones: new Map(), selectedDroneId: null }),
}));

import { MissionAdvisories } from "@/components/planner/MissionAdvisories";
import { useGeofenceStore } from "@/stores/geofence-store";
import type { Waypoint } from "@/lib/types";

function wp(id: string, lat: number, lon: number): Waypoint {
  return { id, lat, lon, alt: 50 };
}

describe("MissionAdvisories", () => {
  beforeEach(() => {
    cleanup();
    useGeofenceStore.setState({ enabled: false });
  });

  it("shows an airport-proximity advisory for a mission next to an airport", () => {
    // San Francisco International (KSFO) sits at 37.6213, -122.379.
    render(
      <MissionAdvisories
        waypoints={[wp("a", 37.6213, -122.379), wp("b", 37.63, -122.38)]}
        onSelectWaypoint={() => {}}
      />,
    );
    expect(screen.getByText(/San Francisco International/i)).toBeTruthy();
  });

  it("always surfaces the item-count advisory line", () => {
    render(
      <MissionAdvisories
        waypoints={[wp("a", 12.0, 77.0)]}
        onSelectWaypoint={() => {}}
      />,
    );
    // Identity-mocked i18n renders the key verbatim.
    expect(screen.getByText("itemCount.advisory")).toBeTruthy();
  });
});
