/**
 * @license GPL-3.0-only
 *
 * The link-quality meter and the sensor health bar must decay with the link.
 * Both read ring buffers that keep their last sample forever, so a SiK link
 * that dropped at four green bars kept showing "excellent", and every sensor
 * stayed green "OK", for as long as the page stayed open.
 */

import { cleanup, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import messages from "../../../../locales/en.json";
import { ConnectionQualityMeter } from "@/components/indicators/ConnectionQualityMeter";
import { SensorHealthBar } from "@/components/shared/SensorHealthBar";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { TELEMETRY_STALE_MS } from "@/lib/telemetry/freshness";

function renderMeter() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ConnectionQualityMeter />
    </NextIntlClientProvider>,
  );
}

function pushRadio(ageMs: number) {
  useTelemetryStore.getState().pushRadio({
    timestamp: Date.now() - ageMs,
    rssi: 200,
    remrssi: 190,
    txbuf: 100,
    noise: 40,
    remnoise: 40,
    rxerrors: 0,
    fixed: 0,
    sourceSystemId: 51,
  });
}

/** Gyro, accel and compass present, enabled and healthy. */
function pushSysStatus(ageMs: number) {
  useTelemetryStore.getState().pushSysStatus({
    timestamp: Date.now() - ageMs,
    cpuLoad: 200,
    sensorsPresent: 0b111,
    sensorsEnabled: 0b111,
    sensorsHealthy: 0b111,
    voltageMv: 16_000,
    currentCa: 900,
    batteryRemaining: 70,
    dropRateComm: 0,
    errorsComm: 0,
  });
}

beforeEach(() => useTelemetryStore.getState().clear());
afterEach(cleanup);

describe("ConnectionQualityMeter freshness", () => {
  it("renders nothing before any radio report", () => {
    expect(renderMeter().container.textContent).toBe("");
  });

  it("shows live signal bars from a fresh report", () => {
    pushRadio(0);
    const { container } = renderMeter();
    expect(container.querySelector("[data-testid='connection-quality-stale']")).toBeNull();
    expect(container.querySelectorAll(".bg-status-success")).toHaveLength(4);
  });

  it("shows an explicit stale state, not the last bars, once the radio goes quiet", () => {
    pushRadio(TELEMETRY_STALE_MS + 1_000);
    const { container } = renderMeter();
    expect(container.querySelector("[data-testid='connection-quality-stale']")).not.toBeNull();
    expect(container.querySelectorAll(".bg-status-success")).toHaveLength(0);
  });
});

describe("SensorHealthBar freshness", () => {
  it("colours sensors from a fresh SYS_STATUS", () => {
    pushSysStatus(0);
    const { container } = render(<SensorHealthBar />);
    expect(container.querySelectorAll(".bg-status-success").length).toBeGreaterThan(0);
  });

  it("stops calling sensors healthy once SYS_STATUS goes stale", () => {
    pushSysStatus(TELEMETRY_STALE_MS + 1_000);
    const { container } = render(<SensorHealthBar />);
    expect(container.querySelector("[data-testid='sensor-health-stale']")).not.toBeNull();
    expect(container.querySelectorAll(".bg-status-success")).toHaveLength(0);
  });

  it("makes no sensor claims when the surface knows no FC is attached", () => {
    pushSysStatus(0);
    const { container } = render(<SensorHealthBar fcLive={false} />);
    expect(container.querySelector("[data-testid='sensor-health-none']")).not.toBeNull();
    expect(container.querySelectorAll(".bg-status-success")).toHaveLength(0);
  });
});
