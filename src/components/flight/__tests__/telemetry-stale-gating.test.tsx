/**
 * @license GPL-3.0-only
 *
 * The telemetry ring buffers keep their last sample when the FC link dies, so
 * a frozen value would otherwise render as if it were live (0deg attitude, 0%
 * battery, a stuck heading). These tests pin the freshness gating: when a
 * channel's latest sample is older than the freshness window the readouts blank
 * to their placeholders and surface a "link silent" note instead of showing the
 * stale value.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

import { FlightDataCard } from "@/components/command/shared/FlightDataCard";
import messages from "../../../../locales/en.json";
import { TelemetryReadout } from "@/components/flight/TelemetryReadout";
import { useTelemetryStore } from "@/stores/telemetry-store";

// The telemetry deck pulls in unrelated store wiring; stub it so these tests
// focus on the readout gating.
vi.mock("@/components/flight/telemetry-deck/TelemetryDeck", () => ({
  useTelemetryDeck: () => ({ controls: null, panel: null }),
}));

function seedAttitude(ageMs: number) {
  // clear() swaps in fresh ring buffers, so re-read state before pushing or
  // the push lands in the orphaned (pre-clear) buffer the component never sees.
  useTelemetryStore.getState().clear();
  const s = useTelemetryStore.getState();
  s.attitude.push({
    timestamp: Date.now() - ageMs,
    roll: 12.3,
    pitch: -4.5,
    yaw: 90,
    rollSpeed: 0,
    pitchSpeed: 0,
    yawSpeed: 0,
  });
}

function seedFlight(ageMs: number) {
  useTelemetryStore.getState().clear();
  const s = useTelemetryStore.getState();
  const ts = Date.now() - ageMs;
  s.position.push({
    timestamp: ts,
    lat: 12.9,
    lon: 77.6,
    alt: 50,
    relativeAlt: 50,
    heading: 90,
    groundSpeed: 5,
    airSpeed: 5,
    climbRate: 1.2,
  });
  s.battery.push({
    timestamp: ts,
    voltage: 16.2,
    current: 10,
    remaining: 80,
    consumed: 100,
  });
}

function seedGps(ageMs: number, satellites: number) {
  useTelemetryStore.getState().clear();
  const s = useTelemetryStore.getState();
  s.gps.push({
    timestamp: Date.now() - ageMs,
    fixType: 3,
    satellites,
    hdop: 0.9,
    lat: 12.9,
    lon: 77.6,
    alt: 900,
  });
}

beforeEach(() => {
  cleanup();
  useTelemetryStore.getState().clear();
});

/** FlightDataCard translates its FC-link labels, so it needs the intl context. */
function renderFlightDataCard() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <FlightDataCard />
    </NextIntlClientProvider>,
  );
}

describe("FlightDataCard attitude freshness gating", () => {
  it("shows live attitude when the channel is fresh", () => {
    seedAttitude(0);
    const { container } = renderFlightDataCard();
    expect(container.textContent).toContain("12.3");
    expect(container.textContent).not.toContain("link silent");
  });

  it("blanks stale attitude to the placeholder and flags the link silent", () => {
    seedAttitude(10_000); // older than the freshness window
    const { container } = renderFlightDataCard();
    expect(container.textContent).not.toContain("12.3");
    expect(container.textContent).toContain("--.-");
    expect(container.textContent).toContain("link silent");
  });
});

describe("TelemetryReadout flight + battery freshness gating", () => {
  it("shows live ALT and battery when fresh", () => {
    seedFlight(0);
    const { container } = render(<TelemetryReadout />);
    expect(container.textContent).toContain("50.0m");
    expect(container.textContent).toContain("80%");
    expect(container.textContent).not.toContain("link silent");
  });

  it("blanks stale ALT and battery and flags the link silent", () => {
    seedFlight(10_000);
    const { container } = render(<TelemetryReadout />);
    expect(container.textContent).not.toContain("50.0m");
    expect(container.textContent).toContain("--.-m");
    expect(container.textContent).toContain("--%");
    expect(container.textContent).toContain("link silent");
  });
});

describe("TelemetryReadout satellite count", () => {
  it("shows the reported satellite count when the fix is fresh", () => {
    seedGps(0, 14);
    const { container } = render(<TelemetryReadout />);
    expect(container.textContent).toContain("14");
    expect(container.textContent).toContain("SAT");
  });

  it("reads unknown when no GPS message has ever arrived", () => {
    // Never seeded. "0 SAT" would claim the receiver has locked onto nothing,
    // which is a stronger statement than having heard no fix report at all.
    const { container } = render(<TelemetryReadout />);
    expect(container.textContent).toContain("--");
    expect(container.textContent).not.toMatch(/\b0\s*SAT/);
  });

  it("keeps a genuine zero-satellite report distinct from an absent one", () => {
    seedGps(0, 0);
    const { container } = render(<TelemetryReadout />);
    // A live GPS message that reports 0 satellites IS a measurement, so it
    // renders as 0 rather than collapsing into the unknown placeholder.
    expect(container.textContent).toMatch(/0\s*SAT/);
  });

  it("blanks the satellite count once the fix goes stale", () => {
    seedGps(10_000, 14);
    const { container } = render(<TelemetryReadout />);
    expect(container.textContent).not.toContain("14");
    expect(container.textContent).toContain("--");
  });
});
