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
import { render, cleanup, act } from "@testing-library/react";

import { TelemetryReadout } from "@/components/flight/TelemetryReadout";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useDroneStore } from "@/stores/drone-store";

// The telemetry deck pulls in unrelated store wiring; stub it so these tests
// focus on the readout gating.
vi.mock("@/components/flight/telemetry-deck/TelemetryDeck", () => ({
  useTelemetryDeck: () => ({ controls: null, panel: null }),
}));

const toastSpy = vi.hoisted(() => vi.fn());
vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ toast: toastSpy }),
}));

function seedFlight(ageMs: number) {
  useTelemetryStore.getState().clear();
  const s = useTelemetryStore.getState();
  const ts = Date.now() - ageMs;
  s.position.push({
    timestamp: ts,
    lat: 12.9,
    lon: 77.6,
    // MSL 950 m at a site 908 m above sea level: 42 m above home.
    alt: 950,
    relativeAlt: 42,
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
  toastSpy.mockClear();
  useDroneStore.setState({ flightMode: "STABILIZE", lastHeartbeat: 0 });
});

describe("TelemetryReadout flight + battery freshness gating", () => {
  it("shows live ALT (height above home) and battery when fresh", () => {
    seedFlight(0);
    const { container } = render(<TelemetryReadout />);
    expect(container.textContent).toContain("42.0m");
    expect(container.textContent).not.toContain("950");
    expect(container.textContent).toContain("80%");
    expect(container.textContent).not.toContain("link silent");
  });

  it("names the unit of the speed and climb readouts", () => {
    // 5 m/s ground speed renders as 18.0 km/h; a bare "18.0" reads as m/s on
    // every other surface, so the unit must be on screen with the number.
    seedFlight(0);
    const { getByText } = render(<TelemetryReadout />);
    expect(getByText("18.0").nextElementSibling?.textContent).toBe("SPD km/h");
    expect(getByText("1.2").nextElementSibling?.textContent).toBe("VS m/s");
  });

  it("blanks stale ALT and battery and flags the link silent", () => {
    seedFlight(10_000);
    const { container } = render(<TelemetryReadout />);
    expect(container.textContent).not.toContain("42.0m");
    expect(container.textContent).toContain("--.-m");
    expect(container.textContent).toContain("--%");
    expect(container.textContent).toContain("link silent");
  });

  it("never takes a field from a stale source while another channel is live", () => {
    // Position went stale; VFR_HUD keeps arriving. VFR_HUD.alt is MSL, so it
    // is no stand-in for height above home, and the stale position must not
    // win the speed/heading fallback.
    seedFlight(10_000);
    useTelemetryStore.getState().vfr.push({
      timestamp: Date.now(),
      airspeed: 7,
      groundspeed: 2.5,
      heading: 270,
      throttle: 40,
      alt: 950,
      climb: -0.3,
    });
    const { container } = render(<TelemetryReadout />);
    expect(container.textContent).toContain("--.-m");
    expect(container.textContent).not.toContain("950");
    expect(container.textContent).toContain("270\u00B0");
    expect(container.textContent).toContain("9.0"); // 2.5 m/s in km/h
  });

  it("reads an FC-reported -1 battery percentage as unknown", () => {
    seedFlight(0);
    useTelemetryStore.getState().battery.push({
      timestamp: Date.now(),
      voltage: 16.2,
      current: 10,
      remaining: -1,
      consumed: 100,
    });
    const { container } = render(<TelemetryReadout />);
    expect(container.textContent).toContain("--%");
    expect(container.textContent).not.toContain("-1%");
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

describe("TelemetryReadout flight mode", () => {
  it("shows no mode until a live heartbeat backs one", () => {
    // Between a drone switch and its first heartbeat the store holds a
    // placeholder mode; after link loss it holds the last one.
    useDroneStore.setState({ flightMode: "AUTO", lastHeartbeat: 0 });
    const { container } = render(<TelemetryReadout />);
    expect(container.textContent).not.toContain("AUTO");
  });

  it("does not announce the first heartbeat after a switch as a mode change", () => {
    const { container } = render(<TelemetryReadout />);
    act(() => useDroneStore.setState({ flightMode: "LOITER", lastHeartbeat: Date.now() }));
    expect(container.textContent).toContain("LOITER");
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it("announces a change between two heartbeat-backed modes", () => {
    useDroneStore.setState({ flightMode: "LOITER", lastHeartbeat: Date.now() });
    render(<TelemetryReadout />);
    act(() => useDroneStore.setState({ flightMode: "RTL", lastHeartbeat: Date.now() }));
    expect(toastSpy).toHaveBeenCalledWith("Mode changed: LOITER -> RTL", "info");
  });
});
