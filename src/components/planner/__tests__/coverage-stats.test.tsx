/**
 * @license GPL-3.0-only
 * CoverageStats: renders survey coverage figures from the generated waypoints,
 * and stays silent when there is no camera or no survey route.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k }));
vi.mock("@/lib/storage", () => ({
  indexedDBStorage: {
    storage: () => ({
      getItem: vi.fn(async () => null),
      setItem: vi.fn(async () => {}),
      removeItem: vi.fn(async () => {}),
    }),
  },
}));

import { CoverageStats } from "@/components/planner/CoverageStats";
import { usePatternStore } from "@/stores/pattern-store";
import { CAMERA_PROFILES } from "@/lib/patterns/gsd-calculator";
import type { PatternResult, PatternWaypoint } from "@/lib/patterns/types";

const camera = CAMERA_PROFILES.find((c) => c.name === "DJI Mavic 3")!;

function wp(lat: number, lon: number): PatternWaypoint {
  return { lat, lon, alt: 50, speed: 5, command: "WAYPOINT" };
}

function trigger(lat: number, lon: number, distance: number): PatternWaypoint {
  return { lat, lon, alt: 50, speed: 5, command: "DO_SET_CAM_TRIGG", param1: distance };
}

/** Two ~111 m north-south transects, the camera armed every 50 m along each. */
function surveyResult(triggerM: number): PatternResult {
  return {
    waypoints: [
      wp(12.9716, 77.5946), trigger(12.9716, 77.5946, triggerM),
      wp(12.9726, 77.5946), trigger(12.9726, 77.5946, 0),
      wp(12.9726, 77.5948), trigger(12.9726, 77.5948, triggerM),
      wp(12.9716, 77.5948), trigger(12.9716, 77.5948, 0),
    ],
    stats: { totalDistance: 0, estimatedTime: 0, photoCount: 0, coveredArea: 0, transectCount: 0 },
  };
}

beforeEach(() => {
  usePatternStore.setState({ activePatternType: "survey", patternResult: surveyResult(50) });
});

describe("CoverageStats", () => {
  it("counts the captures the trigger distance takes along the transects", () => {
    render(<CoverageStats camera={camera} altitude={50} minSideOverlap={0.6} />);
    expect(screen.getByText("coverage.title")).toBeInTheDocument();
    // 0, 50 and 100 m along each 111 m transect.
    expect(screen.getByText("6")).toBeInTheDocument();
  });

  it("shows no front overlap when the camera is never armed", () => {
    usePatternStore.setState({ patternResult: surveyResult(0) });
    render(<CoverageStats camera={camera} altitude={50} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("renders nothing without a camera", () => {
    const { container } = render(<CoverageStats camera={undefined} altitude={50} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when the active pattern is not a survey", () => {
    usePatternStore.setState({ activePatternType: "orbit" });
    const { container } = render(<CoverageStats camera={camera} altitude={50} />);
    expect(container.firstChild).toBeNull();
  });
});
