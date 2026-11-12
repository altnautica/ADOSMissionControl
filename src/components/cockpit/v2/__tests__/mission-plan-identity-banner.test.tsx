/**
 * @license GPL-3.0-only
 *
 * The flight screen's "plan on drone differs" banner: a failed or empty
 * download is said and nothing is loaded, unsaved edits to the open plan are
 * offered for saving first, a good download becomes a new library plan, and
 * its words come from the locale files.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";

import { renderWithIntl } from "../../../../../tests/helpers/intl-wrapper";
import en from "../../../../../locales/en.json";
import { useMissionStore } from "@/stores/mission-store";
import { usePlanLibraryStore } from "@/stores/plan-library-store";
import type { Waypoint } from "@/lib/types";

vi.mock("@/lib/mission/mission-mirror", () => ({ useDronePlanIdentity: () => "differs" }));

import { MissionPlanIdentityBanner } from "../MissionPlanIdentityBanner";

const WP = { id: "w1", lat: 1, lon: 2, alt: 30, command: "WAYPOINT" } as unknown as Waypoint;

const original = useMissionStore.getState().downloadMission;

function stubDownload(result: Waypoint[], state: Record<string, unknown>) {
  useMissionStore.setState({
    downloadMission: vi.fn(async () => {
      useMissionStore.setState({ downloadWarnings: [], ...state });
      return result;
    }),
  });
}

async function press() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: en.flightScreen.planBanner.load }));
  });
}

describe("plan identity banner", () => {
  beforeEach(() => {
    usePlanLibraryStore.setState({ activePlanId: null, isDirty: false });
  });
  afterEach(() => {
    useMissionStore.setState({ downloadMission: original, downloadState: "idle", downloadError: null });
  });

  it("reads its words from the locale files", () => {
    renderWithIntl(<MissionPlanIdentityBanner droneId="d1" />);
    expect(screen.getByTestId("plan-identity-banner").textContent).toContain(en.flightScreen.planBanner.differs);
  });

  it("says a failed download and loads nothing", async () => {
    const createPlan = vi.spyOn(usePlanLibraryStore.getState(), "createPlan");
    stubDownload([], { downloadState: "error", downloadError: "timed out" });
    renderWithIntl(<MissionPlanIdentityBanner droneId="d1" />);
    await press();
    expect(screen.getByTestId("plan-identity-error").textContent).toContain("timed out");
    expect(createPlan).not.toHaveBeenCalled();
    createPlan.mockRestore();
  });

  it("says an empty drone instead of loading an empty plan", async () => {
    stubDownload([], { downloadState: "downloaded", downloadError: null });
    renderWithIntl(<MissionPlanIdentityBanner droneId="d1" />);
    await press();
    expect(screen.getByTestId("plan-identity-error").textContent).toBe(en.plannerIo.vehicleHasNoMission);
  });

  it("asks before replacing an open plan with unsaved edits", async () => {
    usePlanLibraryStore.setState({ activePlanId: "p1", isDirty: true });
    stubDownload([WP], { downloadState: "downloaded", downloadError: null });
    renderWithIntl(<MissionPlanIdentityBanner droneId="d1" />);
    await press();
    expect(useMissionStore.getState().downloadMission).not.toHaveBeenCalled();
    expect(screen.getByText(en.common.unsavedChangesDialog.message)).toBeTruthy();
  });

  it("puts a good download into a new library plan", async () => {
    const createPlan = vi.spyOn(usePlanLibraryStore.getState(), "createPlan").mockReturnValue("p2");
    stubDownload([WP], { downloadState: "downloaded", downloadError: null });
    renderWithIntl(<MissionPlanIdentityBanner droneId="d1" />);
    await press();
    expect(createPlan).toHaveBeenCalledWith(
      expect.stringContaining("Drone Mission"),
      [WP],
      { droneId: "d1" },
      expect.anything(),
    );
    expect(screen.queryByTestId("plan-identity-error")).toBeNull();
    createPlan.mockRestore();
  });
});
