/**
 * Health-check indicators render a sample only while it is fresh. After a link
 * loss the last fix, EKF variances, vibration levels and sensor verdicts must
 * not stay on screen as if current.
 *
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, screen } from "@testing-library/react";

import { renderWithIntl } from "../../helpers/intl-wrapper";
import { EkfStatusBars } from "@/components/indicators/EkfStatusBars";
import { GpsSkyView } from "@/components/indicators/GpsSkyView";
import { SensorHealthGrid } from "@/components/indicators/SensorHealthGrid";
import { VibrationGauges } from "@/components/indicators/VibrationGauges";
import { TELEMETRY_STALE_MS } from "@/lib/telemetry/freshness";
import { useTelemetryStore } from "@/stores/telemetry-store";

const OLD = () => Date.now() - TELEMETRY_STALE_MS - 1_000;

beforeEach(() => {
  useTelemetryStore.getState().clear();
});
afterEach(cleanup);

describe("stale health indicators", () => {
  it("GPS: a fix that stopped arriving reads as no data, not '3D Fix · 14 sats'", () => {
    act(() => {
      useTelemetryStore.getState().gps.push({
        timestamp: OLD(),
        fixType: 3,
        satellites: 14,
        hdop: 0.8,
        lat: 12.9,
        lon: 77.6,
        alt: 900,
      } as never);
    });
    renderWithIntl(<GpsSkyView />);
    expect(screen.queryByText(/14/)).toBeNull();
    expect(screen.getByText(/GPS · No Data/)).toBeTruthy();
  });

  it("EKF: variances that stopped arriving are not drawn", () => {
    act(() => {
      useTelemetryStore.getState().ekf.push({
        timestamp: OLD(),
        velocityVariance: 0.3,
        posHorizVariance: 0.6,
        posVertVariance: 0.1,
        compassVariance: 0.2,
        terrainAltVariance: 0,
        flags: 0,
      } as never);
    });
    renderWithIntl(<EkfStatusBars />);
    expect(screen.queryByText("0.30")).toBeNull();
    expect(screen.getByText(/EKF · No Data/)).toBeTruthy();
  });

  it("Vibration: the last levels are not drawn once stale", () => {
    act(() => {
      useTelemetryStore.getState().vibration.push({
        timestamp: OLD(),
        vibrationX: 12.5,
        vibrationY: 8,
        vibrationZ: 20,
        clipping0: 0,
        clipping1: 0,
        clipping2: 0,
      });
    });
    renderWithIntl(<VibrationGauges />);
    expect(screen.queryByText("12.5")).toBeNull();
    expect(screen.getByText(/no current data/)).toBeTruthy();
  });

  it("Sensors: stale SYS_STATUS verdicts are not shown as green chips", () => {
    act(() => {
      useTelemetryStore.getState().pushSysStatus({
        timestamp: OLD(),
        cpuLoad: 100,
        sensorsPresent: 0b111,
        sensorsEnabled: 0b111,
        sensorsHealthy: 0b111,
        batteryRemaining: -1,
        dropRateComm: 0,
        errorsComm: 0,
      });
    });
    const { container } = renderWithIntl(<SensorHealthGrid />);
    expect(container.querySelector(".text-status-success")).toBeNull();
    expect(screen.getByText(/Sensors · No Data/)).toBeTruthy();
  });
});
