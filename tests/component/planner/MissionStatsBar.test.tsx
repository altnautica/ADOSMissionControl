/**
 * Render tests for MissionStatsBar. Verifies that the operator's unit-system
 * setting drives the formatted distance / altitude / speed strings, routed
 * through the shared units formatters.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Waypoint } from "@/lib/types";

vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k }));

// The stats bar reads the plan's distance and duration; pin them so the
// assertions are deterministic and independent of the haversine internals.
// 1500 m over 150 s is a 10 m/s route mean, unlike the 5 m/s default passed in.
vi.mock("@/lib/simulation-utils", () => ({
  computeFlightPlan: () => ({ totalDistance: 1500, totalDuration: 150 }),
}));

// A mutable holder for the units setting the mocked settings store returns.
const settings = vi.hoisted(() => ({ units: "metric" as "metric" | "imperial" }));
vi.mock("@/stores/settings-store", () => ({
  useSettingsStore: (selector: (s: { units: string }) => unknown) =>
    selector({ units: settings.units }),
}));

import { MissionStatsBar } from "@/components/planner/MissionStatsBar";

const waypoints = [{ id: "1", alt: 100 }] as unknown as Waypoint[];

describe("MissionStatsBar unit formatting", () => {
  it("renders metric distance / altitude / speed", () => {
    settings.units = "metric";
    render(<MissionStatsBar waypoints={waypoints} defaultSpeed={5} />);
    expect(screen.getByText("1.50 km")).toBeDefined();
    expect(screen.getByText("100 m max")).toBeDefined();
    expect(screen.getByText("10.0 m/s avg")).toBeDefined();
  });

  it("renders imperial distance / altitude / speed when the setting flips", () => {
    settings.units = "imperial";
    render(<MissionStatsBar waypoints={waypoints} defaultSpeed={5} />);
    // 1500 m < 1 mi → feet; 100 m → 328 ft; 10 m/s → 22.4 mph.
    expect(screen.getByText("4921 ft")).toBeDefined();
    expect(screen.getByText("328 ft max")).toBeDefined();
    expect(screen.getByText("22.4 mph avg")).toBeDefined();
    // The metric strings must NOT be present in imperial mode.
    expect(screen.queryByText("1.50 km")).toBeNull();
    expect(screen.queryByText("10.0 m/s avg")).toBeNull();
  });
});
