/**
 * @license GPL-3.0-only
 *
 * The PID Tuning subtitle names the connected firmware: PX4 rate PIDs are not
 * described with ArduPilot names, and a PX4 VTOL opens on the multicopter
 * axes with a pointer to Fixed-Wing Tuning.
 */

import { describe, it, expect, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { render, screen } from "@testing-library/react";

import messages from "../../../../../locales/en.json";

const state = { firmwareType: "px4", vehicleClass: "vtol" };

vi.mock("@/hooks/use-firmware-capabilities", () => ({
  useFirmwareCapabilities: () => ({ firmwareType: state.firmwareType }),
}));
vi.mock("@/stores/drone-manager", () => {
  const s = { selectedDroneId: "d1", drone: { vehicleInfo: { vehicleClass: "" } } };
  return {
    useDroneManager: (sel: (x: unknown) => unknown) => sel(s),
    selectSelectedProtocol: () => null,
    selectSelectedDrone: () => ({ vehicleInfo: { vehicleClass: state.vehicleClass } }),
  };
});
vi.mock("@/stores/pid-analysis-store", () => ({
  usePidAnalysisStore: (sel: (x: { bindDrone: () => void }) => unknown) => sel({ bindDrone: () => {} }),
}));
vi.mock("@/hooks/use-panel-params", () => ({
  usePanelParams: () => ({
    params: new Map<string, number>(),
    loading: false,
    error: null,
    dirtyParams: new Set<string>(),
    hasRamWrites: false,
    loadProgress: null,
    hasLoaded: true,
    refresh: vi.fn(),
    setLocalValue: vi.fn(),
    saveAllToRam: vi.fn(),
    commitToFlash: vi.fn(),
    revertAll: vi.fn(),
  }),
}));
vi.mock("@/hooks/use-unsaved-guard", () => ({ useUnsavedGuard: () => undefined }));
vi.mock("@/hooks/use-panel-scroll", () => ({ usePanelScroll: () => ({ current: null }) }));
vi.mock("@/hooks/use-param-metadata", () => ({ useParamMetadataMap: () => new Map() }));
vi.mock("@/lib/fc-setup/use-fc-setup", () => ({ useAgentFcSetup: () => null }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("../PidAnalysisSection", () => ({ PidAnalysisSection: () => null }));
vi.mock("../PidComparisonSection", () => ({
  AutotuneSection: () => null,
  LivePidResponseGraph: () => null,
  PidSnapshotComparison: () => null,
  Px4GainMultipliers: () => null,
}));
vi.mock("../../calibration/AgentSetupStep", () => ({ AgentSetupStep: () => null }));

import { PidTuningPanel } from "../PidTuningPanel";

function renderPanel() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <PidTuningPanel />
    </NextIntlClientProvider>,
  );
}

const sub = messages.fcPanels.pidTuningPanel;

describe("PidTuningPanel · firmware-aware subtitle", () => {
  it("PX4 VTOL opens on the multicopter rates with a Fixed-Wing Tuning pointer", () => {
    state.firmwareType = "px4";
    state.vehicleClass = "vtol";
    renderPanel();
    expect(screen.getByText(sub.subtitleCopterPx4)).toBeInTheDocument();
    expect(screen.queryByText(sub.subtitleCopter)).toBeNull();
  });

  it("ArduPilot copter keeps the ArduCopter subtitle", () => {
    state.firmwareType = "ardupilot-copter";
    state.vehicleClass = "copter";
    renderPanel();
    expect(screen.getByText(sub.subtitleCopter)).toBeInTheDocument();
  });
});
