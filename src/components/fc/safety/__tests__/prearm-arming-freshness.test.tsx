/**
 * @module fc/safety/prearm-arming-freshness.test
 * @description The Health Check's MSP arming badge is a verdict about the
 * aircraft now. The arming word is a scalar that keeps its last value when MSP
 * status stops arriving, so an "OK TO ARM" read before a link drop must turn
 * stale rather than stay green.
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/indicators/SensorHealthGrid", () => ({ SensorHealthGrid: () => null }));
vi.mock("@/components/indicators/EkfStatusBars", () => ({ EkfStatusBars: () => null }));
vi.mock("@/components/indicators/VibrationGauges", () => ({ VibrationGauges: () => null }));
vi.mock("@/components/indicators/GpsSkyView", () => ({ GpsSkyView: () => null }));
vi.mock("@/components/indicators/PreArmChecks", () => ({ PreArmChecks: () => null }));

let firmwareType = "inav";
const protocol = { getVehicleInfo: () => ({ firmwareType }) };
vi.mock("@/stores/drone-manager", () => ({
  useDroneManager: (sel: (s: unknown) => unknown) => sel(null),
  selectSelectedProtocol: () => protocol,
}));

import { PreArmPanel } from "../PreArmPanel";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useClockStore } from "@/stores/clock-store";

const NOW = 1_800_000_000_000;

beforeEach(() => {
  firmwareType = "inav";
  useClockStore.setState({ now: NOW });
});

describe("PreArmPanel MSP arming badge", () => {
  it("shows the verdict while the arming word is current", () => {
    useTelemetryStore.setState({ armingFlags: 0, armingFlagsUpdatedAt: NOW - 1_000 });
    render(<PreArmPanel />);
    expect(screen.getByText("OK TO ARM")).toBeTruthy();
  });

  it("stops claiming OK TO ARM once MSP status has stopped arriving", () => {
    useTelemetryStore.setState({ armingFlags: 0, armingFlagsUpdatedAt: NOW - 30_000 });
    render(<PreArmPanel />);
    expect(screen.queryByText("OK TO ARM")).toBeNull();
    expect(screen.getByText("STALE")).toBeTruthy();
  });

  it("offers no refresh control that sends nothing", () => {
    useTelemetryStore.setState({ armingFlags: 0, armingFlagsUpdatedAt: NOW - 1_000 });
    render(<PreArmPanel />);
    expect(screen.queryByRole("button", { name: /refresh/i })).toBeNull();
  });

  it("decodes a Betaflight word with the flag count the firmware sent", () => {
    // A 30-flag build: CRASHFLIP is bit 25 and ARM_SWITCH moved to bit 29.
    firmwareType = "betaflight";
    useTelemetryStore.setState({
      armingFlags: (1 << 25) | (1 << 29),
      armingFlagCount: 30,
      armingFlagsUpdatedAt: NOW - 1_000,
    });
    render(<PreArmPanel />);
    expect(screen.getByText("Crash flip mode")).toBeTruthy();
    expect(screen.getByText("Arm switch")).toBeTruthy();
    expect(screen.queryByText(/Unknown flag/)).toBeNull();
  });
});
