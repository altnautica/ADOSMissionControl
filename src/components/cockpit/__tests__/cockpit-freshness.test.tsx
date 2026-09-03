/**
 * @module cockpit/cockpit-freshness.test
 * @description The safety band and the flight clock must stop asserting
 * things they no longer know.
 *
 * Two defects are pinned here:
 *
 * - Every ring buffer keeps its last sample forever, so the band read
 *   `latest()` and painted the last battery percentage, GPS fix, and signal
 *   bars for as long as the tab stayed open after a link loss. Its own module
 *   doc claimed the values were freshness-gated; nothing gated them.
 * - The flight clock captured `Date.now()` inside a `useEffect`, so it
 *   restarted at 0:00 on remount. Switching to the map and back reset the
 *   flight timer mid-flight.
 *
 * @license GPL-3.0-only
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";

import messages from "../../../../locales/en.json";
import { CockpitTopBar } from "@/components/cockpit/CockpitTopBar";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useDroneStore } from "@/stores/drone-store";
import { TELEMETRY_STALE_MS } from "@/lib/telemetry/freshness";

function renderBand() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <CockpitTopBar />
    </NextIntlClientProvider>,
  );
}

/** Push one sample of each safety reading, stamped `ageMs` in the past. */
function seedTelemetry(ageMs: number) {
  const timestamp = Date.now() - ageMs;
  const s = useTelemetryStore.getState();
  s.pushBattery({
    timestamp,
    voltage: 22.2,
    current: 8.4,
    remaining: 76,
    consumed: 1200,
  });
  s.pushGps({
    timestamp,
    fixType: 3,
    satellites: 14,
    hdop: 0.9,
    lat: 12.9716,
    lon: 77.5946,
    alt: 920,
  });
  s.pushRadio({
    timestamp,
    rssi: -55,
    remrssi: -58,
    txbuf: 100,
    noise: 20,
    remnoise: 22,
    rxerrors: 0,
    fixed: 0,
  });
}

describe("cockpit safety band freshness", () => {
  beforeEach(() => {
    useDroneStore.setState({ armState: "disarmed", armedAt: null });
  });
  afterEach(cleanup);

  it("shows a fresh battery percentage and GPS fix", () => {
    seedTelemetry(0);
    renderBand();
    expect(screen.getByText(/76/)).toBeTruthy();
    expect(screen.getByText(/3D \/ 14/)).toBeTruthy();
  });

  it("blanks the same readings once they age past the staleness window", () => {
    seedTelemetry(TELEMETRY_STALE_MS + 1_000);
    renderBand();

    // The values are still sitting in the ring buffers; the band must not
    // present them as current.
    expect(useTelemetryStore.getState().battery.latest()?.remaining).toBe(76);
    expect(screen.queryByText(/76/)).toBeNull();

    // "NO FIX" rather than a stale 3D lock with 14 satellites.
    expect(screen.queryByText(/3D \/ 14/)).toBeNull();
    expect(screen.getByText(messages.cockpit.strip.gpsNoFix)).toBeTruthy();
  });

  it("treats a sample exactly at the threshold as stale", () => {
    seedTelemetry(TELEMETRY_STALE_MS);
    renderBand();
    expect(screen.queryByText(/76/)).toBeNull();
  });
});

describe("cockpit flight clock", () => {
  beforeEach(() => {
    useDroneStore.setState({ armState: "disarmed", armedAt: null });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("reads --:-- while disarmed", () => {
    renderBand();
    expect(screen.getByText("--:--")).toBeTruthy();
  });

  it("counts from the arm transition, and survives a remount", () => {
    // Armed 95 seconds ago: the clock owes us 1:35 no matter how many times
    // the component has mounted since.
    useDroneStore.setState({ armState: "armed", armedAt: Date.now() - 95_000 });

    const first = renderBand();
    expect(screen.getByText("1:35")).toBeTruthy();

    // Leave the cockpit and come back. The old effect-captured clock restarted
    // at 0:00 here, which is the whole defect.
    first.unmount();
    renderBand();
    expect(screen.getByText("1:35")).toBeTruthy();
    expect(screen.queryByText("0:00")).toBeNull();
  });

  it("starts a fresh clock on re-arm rather than continuing the last flight", () => {
    const store = useDroneStore.getState();
    store.setArmState("armed");
    const firstArmedAt = useDroneStore.getState().armedAt;
    expect(firstArmedAt).not.toBeNull();

    useDroneStore.getState().setArmState("disarmed");
    expect(useDroneStore.getState().armedAt).toBeNull();

    useDroneStore.getState().setArmState("armed");
    const secondArmedAt = useDroneStore.getState().armedAt;
    expect(secondArmedAt).not.toBeNull();
    expect(secondArmedAt!).toBeGreaterThanOrEqual(firstArmedAt!);

    renderBand();
    expect(screen.getByText("0:00")).toBeTruthy();
  });

  it("does not restamp when the same arm state is set again", () => {
    useDroneStore.getState().setArmState("armed");
    const armedAt = useDroneStore.getState().armedAt;
    useDroneStore.getState().setArmState("armed");
    expect(useDroneStore.getState().armedAt).toBe(armedAt);
  });
});
