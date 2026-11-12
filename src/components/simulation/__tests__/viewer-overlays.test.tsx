/**
 * @license GPL-3.0-only
 *
 * Simulate's mission warning banner names the first issue and keeps clear of
 * the Map panel and the HUD.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  result: { valid: true, errors: [] as unknown[], warnings: [] as unknown[] },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/hooks/use-validation-options", () => ({ useValidationOptions: () => ({}) }));
vi.mock("@/lib/validation/mission-validator", () => ({ validateMission: () => mocks.result }));

import { renderWithIntl } from "../../../../tests/helpers/intl-wrapper";
import { MissionWarningBanner } from "../MissionWarningBanner";
import type { Waypoint } from "@/lib/types";

const WAYPOINTS: Waypoint[] = [{ id: "a", lat: 1, lon: 1, alt: 30 }];
const issue = (key: string, params?: Record<string, number>) => ({ severity: "warning", code: "x", message: "", text: { key, params } });

afterEach(() => {
  cleanup();
  mocks.push.mockReset();
});

describe("MissionWarningBanner", () => {
  it("names the first warning and how many more there are", () => {
    mocks.result = { valid: true, errors: [], warnings: [issue("wpOutsideGeofencePolygon", { v0: 3 }), issue("homeNotSet")] };
    renderWithIntl(<MissionWarningBanner waypoints={WAYPOINTS} />);
    expect(screen.getByText("Mission has 2 warnings")).toBeInTheDocument();
    expect(screen.getByText("WP3: Outside geofence polygon +1 more")).toBeInTheDocument();
  });

  it("sits in a strip that leaves the Map panel and the HUD uncovered", () => {
    mocks.result = { valid: true, errors: [], warnings: [issue("wpOutsideGeofencePolygon", { v0: 1 })] };
    renderWithIntl(<MissionWarningBanner waypoints={WAYPOINTS} />);
    const strip = screen.getByTestId("mission-warning-banner");
    // Map panel: top-left, 16 px inset, about 263 px wide. HUD: top-right, under 200 px.
    expect(strip.className).toContain("pl-[19rem]");
    expect(strip.className).toContain("pr-52");
    expect(strip.className).not.toContain("left-1/2");
    expect(screen.getByText("WP1: Outside geofence polygon")).toBeInTheDocument();
  });

  it("dismisses from a labelled button", () => {
    mocks.result = { valid: true, errors: [], warnings: [issue("wpOutsideGeofencePolygon", { v0: 1 })] };
    renderWithIntl(<MissionWarningBanner waypoints={WAYPOINTS} />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss warning" }));
    expect(screen.queryByTestId("mission-warning-banner")).toBeNull();
  });
});
