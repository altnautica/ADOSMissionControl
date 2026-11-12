/**
 * @license GPL-3.0-only
 *
 * The level and radio calibration cards carry the shared setup titles, so the
 * setup step "Level horizon" opens a card with the same name.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { IntlWrapper } from "../../../../../tests/helpers/intl-wrapper";

import { setupText } from "@/lib/fc-setup/strings";

const fw = { firmwareType: "ardupilot" as string };

vi.mock("@/hooks/use-armed-lock", () => ({
  useArmedLock: () => ({ isArmed: false, isHardBlocked: false, lockMessage: "", hardBlockMessage: "" }),
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/stores/drone-manager", () => ({
  useDroneManager: (sel: (s: unknown) => unknown) => sel({}),
  selectSelectedProtocol: () => null,
}));
vi.mock("@/hooks/use-firmware-capabilities", () => ({
  useFirmwareCapabilities: () => ({ firmwareType: fw.firmwareType }),
}));
vi.mock("@/hooks/use-telemetry-latest", () => ({ useFreshTelemetry: () => null }));
vi.mock("../CalibrationWizard", () => ({
  CalibrationWizard: ({ title }: { title: string }) => <h3>{title}</h3>,
}));
vi.mock("../AgentSetupStep", () => ({
  AgentSetupStep: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("../../receiver/RcChannelMapSection", () => ({ RcChannelMapSection: () => null }));
vi.mock("../../sensors/GpsConfigSection", () => ({ GpsConfigSection: () => null }));
vi.mock("../../misc/ServoCalibrationSection", () => ({ ServoCalibrationSection: () => null }));

import { RcCalibrationWizard } from "../RcCalibrationWizard";
import { ArduPilotCalibrations } from "../ArduPilotCalibrations";
import type { CalibrationState } from "../calibration-types";

describe("calibration card titles", () => {
  it("titles the radio card with the shared setup word", () => {
    fw.firmwareType = "ardupilot";
    render(<RcCalibrationWizard connected={false} />, { wrapper: IntlWrapper });
    expect(screen.getByRole("heading", { name: setupText("setup.radio.title") })).toBeTruthy();
    expect(screen.queryByText("Radio Calibration")).toBeNull();
  });

  it("keeps the shared title when the firmware cannot calibrate the radio", () => {
    fw.firmwareType = "inav";
    render(<RcCalibrationWizard connected={false} />, { wrapper: IntlWrapper });
    expect(screen.getByRole("heading", { name: setupText("setup.radio.title") })).toBeTruthy();
  });

  it("titles the level card with the shared setup word", () => {
    fw.firmwareType = "ardupilot";
    const idle = { status: "idle", currentStep: 0, progress: 0, message: "" } as unknown as CalibrationState;
    const noop = vi.fn();
    render(
      <ArduPilotCalibrations
        connected={false}
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
    expect(screen.getByRole("heading", { name: setupText("setup.level.title") })).toBeTruthy();
    expect(screen.queryByText("Level Calibration")).toBeNull();
  });
});
