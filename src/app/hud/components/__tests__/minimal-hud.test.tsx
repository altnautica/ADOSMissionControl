/**
 * @module hud/minimal-hud.test
 * @description The low-power kiosk HUD must be as honest as the full one:
 * no attitude is a failure flag rather than a level horizon, no heartbeat is
 * no mode rather than the store default, an FC-reported -1 battery percentage
 * is unknown rather than critical, and a silent link blanks the numbers.
 *
 * @license GPL-3.0-only
 */

import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithIntl } from "../../../../../tests/helpers/intl-wrapper";

vi.mock("@/components/hud/VideoBackground", () => ({ VideoBackground: () => null }));
vi.mock("@/lib/input/gamepad-poller", () => ({
  startGamepadPolling: () => {},
  stopGamepadPolling: () => {},
  startManualControlStream: () => {},
}));

import { MinimalHud } from "../MinimalHud";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useDroneStore } from "@/stores/drone-store";
import { TELEMETRY_STALE_MS } from "@/lib/telemetry/freshness";

const NOW = 1_700_000_000_000;

function pushLive(remaining: number) {
  const t = useTelemetryStore.getState();
  t.pushAttitude({ timestamp: NOW, roll: 10, pitch: 2, yaw: 0, rollSpeed: 0, pitchSpeed: 0, yawSpeed: 0 });
  t.pushBattery({ timestamp: NOW, voltage: 15.2, current: 6, remaining, consumed: 400 });
  t.pushPosition({
    timestamp: NOW,
    lat: 12.97,
    lon: 77.59,
    alt: 340,
    relativeAlt: 40,
    heading: 90,
    groundSpeed: 3,
    airSpeed: 3,
    climbRate: 0,
  });
  useDroneStore.setState({ flightMode: "LOITER", armState: "armed", lastHeartbeat: NOW });
}

describe("minimal kiosk HUD", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
    useTelemetryStore.getState().clear();
    useDroneStore.setState({ flightMode: "STABILIZE", armState: "disarmed", lastHeartbeat: 0 });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("flags the horizon and claims no mode with nothing connected", () => {
    const { container } = renderWithIntl(<MinimalHud />);
    expect(container.querySelector("[data-testid='horizon-attitude-flag']")).not.toBeNull();
    expect(container.textContent).not.toContain("STABILIZE");
    expect(container.textContent).toContain("BAT --%");
  });

  it("shows live readings, with altitude above home", () => {
    pushLive(64);
    const { container } = renderWithIntl(<MinimalHud />);
    expect(container.querySelector("[data-testid='horizon-attitude-flag']")).toBeNull();
    expect(container.textContent).toContain("MODE LOITER");
    expect(container.textContent).toContain("BAT 64%");
    expect(container.textContent).toContain("ALT 40 m");
  });

  it("reads a -1 battery percentage as unknown, not a critical pack", () => {
    pushLive(-1);
    const { container } = renderWithIntl(<MinimalHud />);
    expect(container.textContent).toContain("BAT --%");
    expect(container.querySelector("[data-testid='hud-alert-battCrit']")).toBeNull();
  });

  it("blanks every reading once the link goes silent", () => {
    pushLive(64);
    vi.setSystemTime(NOW + TELEMETRY_STALE_MS + 1_000);
    const { container } = renderWithIntl(<MinimalHud />);
    expect(container.querySelector("[data-testid='horizon-attitude-flag']")).not.toBeNull();
    expect(container.textContent).not.toContain("LOITER");
    expect(container.textContent).not.toContain("64%");
    expect(container.textContent).toContain("ALT -- m");
  });
});
