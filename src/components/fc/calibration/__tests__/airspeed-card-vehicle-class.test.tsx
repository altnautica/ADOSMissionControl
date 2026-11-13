/**
 * @license GPL-3.0-only
 *
 * The airspeed calibration card needs a pitot tube, so it is listed only for a
 * plane or a VTOL, never on a multirotor.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { IntlWrapper } from "../../../../../tests/helpers/intl-wrapper";

const fw: { vehicleClass: string | null } = { vehicleClass: "copter" };

vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/stores/drone-manager", () => ({
  useDroneManager: (sel: (s: unknown) => unknown) => sel({}),
  selectSelectedProtocol: () => null,
}));
vi.mock("@/hooks/use-firmware-capabilities", () => ({
  useFirmwareCapabilities: () => ({ firmwareType: "ardupilot", vehicleClass: fw.vehicleClass }),
}));
vi.mock("../CalibrationWizard", () => ({
  CalibrationWizard: ({ title }: { title: string }) => <h3>{title}</h3>,
}));
vi.mock("../AgentSetupStep", () => ({
  AgentSetupStep: ({ step, children }: { step: string; children: React.ReactNode }) => <div data-testid={`card-${step}`}>{children}</div>,
}));
vi.mock("../RcCalibrationWizard", () => ({ RcCalibrationWizard: () => null }));
vi.mock("../../receiver/RcChannelMapSection", () => ({ RcChannelMapSection: () => null }));
vi.mock("../../sensors/GpsConfigSection", () => ({ GpsConfigSection: () => null }));
vi.mock("../../misc/ServoCalibrationSection", () => ({ ServoCalibrationSection: () => null }));

import { ArduPilotCalibrations } from "../ArduPilotCalibrations";
import type { CalibrationState } from "../calibration-types";

function mount() {
  const idle = { status: "idle", currentStep: 0, progress: 0, message: "" } as unknown as CalibrationState;
  const noop = vi.fn();
  render(
    <ArduPilotCalibrations
      connected
      setup={null}
      level={idle}
      airspeed={idle}
      baro={idle}
      esc={idle}
      compassmot={idle}
      baroPressure={null}
      startCalibration={noop}
      cancelCalibration={noop}
      setLevel={noop}
      setAirspeed={noop}
      setBaro={noop}
      setEsc={noop}
      setCompassmot={noop}
    />,
    { wrapper: IntlWrapper },
  );
}

describe("airspeed calibration card", () => {
  it.each(["copter", "rover", "unknown"])("is not listed on a %s", (cls) => {
    fw.vehicleClass = cls;
    mount();
    expect(screen.queryByTestId("card-airspeed")).toBeNull();
    expect(screen.getByTestId("card-level")).toBeTruthy();
  });

  it.each(["plane", "vtol"])("is listed on a %s", (cls) => {
    fw.vehicleClass = cls;
    mount();
    expect(screen.getByTestId("card-airspeed")).toBeTruthy();
  });
});
