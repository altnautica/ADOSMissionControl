/**
 * Render test for the planner right panel's Review band. Confirms the sun-times,
 * energy, and pre-flight-checklist cards mount alongside terrain + validation.
 * The heavy planner children and stores are stubbed so the test stays focused on
 * the panel's own composition of the Review band.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";

vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k }));

// Store stubs (hoisted so the vi.mock factories can close over them).
const stores = vi.hoisted(() => ({
  planner: {
    selectedWaypointIds: [] as string[],
    clearMultiSelection: () => {},
    mapCenter: [12.97, 77.59] as [number, number],
    setMode: () => {},
  },
  geofence: { enabled: false },
  mission: { waypoints: [] as unknown[], insertWaypoint: () => {} },
}));

vi.mock("@/stores/planner-store", () => ({
  usePlannerStore: Object.assign(
    (sel: (s: typeof stores.planner) => unknown) => sel(stores.planner),
    { getState: () => stores.planner },
  ),
}));
vi.mock("@/stores/geofence-store", () => ({
  useGeofenceStore: (sel: (s: typeof stores.geofence) => unknown) => sel(stores.geofence),
}));
vi.mock("@/stores/mission-store", () => ({
  useMissionStore: Object.assign(
    (sel: (s: typeof stores.mission) => unknown) => sel(stores.mission),
    { getState: () => stores.mission },
  ),
}));

vi.mock("@/hooks/use-validation-options", () => ({ useValidationOptions: () => ({}) }));
vi.mock("@/hooks/use-rtl-return-context", () => ({ useFlightPlanOptions: () => ({}) }));
vi.mock("@/lib/validation/mission-validator", () => ({ validateMission: () => ({ errors: [] }) }));

// Heavy planner children are irrelevant to the Review-band composition.
vi.mock("@/components/planner/MissionEditor", () => ({ MissionEditor: () => null }));
vi.mock("@/components/planner/WaypointList", () => ({ WaypointList: () => null }));
vi.mock("@/components/planner/GeofenceEditor", () => ({ GeofenceEditor: () => null }));
vi.mock("@/components/planner/DefaultsSection", () => ({ DefaultsSection: () => null }));
vi.mock("@/components/planner/RallyPointEditor", () => ({ RallyPointEditor: () => null }));
vi.mock("@/components/planner/ValidationPanel", () => ({ ValidationPanel: () => null }));
vi.mock("@/components/planner/TerrainProfileChart", () => ({ TerrainProfileChart: () => null }));
vi.mock("@/components/planner/TransformPanel", () => ({ TransformPanel: () => null }));
vi.mock("@/components/planner/PatternEditor", () => ({ PatternEditor: () => null }));
vi.mock("@/components/planner/BatchEditor", () => ({ BatchEditor: () => null }));
vi.mock("@/components/planner/MissionActions", () => ({ MissionActions: () => null }));

// The three Review-band cards under test, stubbed to identifiable markers.
vi.mock("@/components/planner/SunTimesCard", () => ({
  SunTimesCard: () => <div data-testid="sun-times-card" />,
}));
vi.mock("@/components/planner/PreflightChecklist", () => ({
  PreflightChecklist: () => <div data-testid="preflight-checklist" />,
}));
vi.mock("@/components/planner/EnergyCard", () => ({
  EnergyCard: () => <div data-testid="energy-card" />,
}));

import { PlannerRightPanel } from "@/app/plan/PlannerRightPanel";

type PanelProps = ComponentProps<typeof PlannerRightPanel>;

const p = {
  waypoints: [],
  isDirty: false,
  activePlanId: null,
  missionName: "",
  togglePanel: vi.fn(),
  drones: [],
  selectedDroneId: null,
  setMissionName: vi.fn(),
  setSelectedDroneId: vi.fn(),
  defaultAlt: 50,
  defaultSpeed: 8,
  defaultAcceptRadius: 5,
  defaultFrame: "relative",
  setDefaults: vi.fn(),
  handlePatternApply: vi.fn(),
  handleAddManualWaypoint: vi.fn(),
  selectedWaypointId: null,
  expandedWaypointId: null,
  handleWaypointClick: vi.fn(),
  setExpandedWaypoint: vi.fn(),
  updateWaypoint: vi.fn(),
  removeWaypoint: vi.fn(),
  reorderWaypoints: vi.fn(),
  rallyPoints: [],
  setSelectedWaypoint: vi.fn(),
  uploadState: "idle",
  downloadState: "idle",
} as unknown as PanelProps["p"];

function renderPanel() {
  render(
    <PlannerRightPanel
      p={p}
      showGeofence={true}
      showRally={false}
      hasDrone={false}
      patternOpen={false}
      validationOpen={false}
      terrainOpen={false}
      togglePattern={vi.fn()}
      toggleValidation={vi.fn()}
      toggleTerrain={vi.fn()}
    />,
  );
}

describe("PlannerRightPanel Review band", () => {
  it("mounts the sun-times, energy, and pre-flight-checklist cards", () => {
    renderPanel();
    expect(screen.getByTestId("sun-times-card")).toBeDefined();
    expect(screen.getByTestId("energy-card")).toBeDefined();
    expect(screen.getByTestId("preflight-checklist")).toBeDefined();
  });
});
