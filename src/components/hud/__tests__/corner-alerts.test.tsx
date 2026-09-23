/**
 * @module hud/corner-alerts.test
 * @description The HUD corner badges must describe the aircraft now, and the
 * stale badge must actually be reachable.
 *
 * Pinned:
 *
 * - The battery and fence badges read `latest()` raw, so "FENCE BREACH" or
 *   "BATT CRIT" stayed on screen for as long as the tab was open after a link
 *   loss, asserting a vehicle state nobody had heard about since.
 * - A battery percentage of -1 is the FC saying "capacity unknown", not an
 *   empty pack, and must not raise BATT CRIT.
 * - "LINK STALE" is the one badge whose entire job is to appear when
 *   telemetry stops. It keys on the selected drone's heartbeat age. The link
 *   tests drive the real drone-manager bridge: an armed heartbeat leaves the
 *   connection state at "armed" and a declared link loss turns it
 *   "disconnected", so a badge gated on "connected" never fired.
 *
 * @license GPL-3.0-only
 */

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";

import messages from "../../../../locales/en.json";
import { CornerAlerts } from "@/components/hud/CornerAlerts";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useDroneStore } from "@/stores/drone-store";
import { useDroneManager } from "@/stores/drone-manager";
import { MockProtocol } from "@/mock/mock-protocol";
import type { Transport } from "@/lib/protocol/types";
import { TELEMETRY_STALE_MS } from "@/lib/telemetry/freshness";

function renderAlerts() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <CornerAlerts />
    </NextIntlClientProvider>,
  );
}

function fakeTransport(): Transport {
  return {
    type: "websocket",
    connect: async () => {},
    disconnect: async () => {},
    send: () => {},
    on: () => {},
    off: () => {},
    isConnected: true,
    canCommand: true,
  };
}

/**
 * Connect one drone through drone-manager (auto-selected, so the bridge
 * writes the single-slot drone store) and return a handle to fire its
 * heartbeat and declared link loss.
 */
async function connectDrone(id: string) {
  const protocol = new MockProtocol();
  let fireLinkLost: (() => void) | undefined;
  const subscribe = protocol.onLinkLost;
  protocol.onLinkLost = (cb) => {
    fireLinkLost = cb;
    return subscribe(cb);
  };
  const transport = fakeTransport();
  const vehicleInfo = await protocol.connect(transport);
  useDroneManager
    .getState()
    .addDrone(id, "Copter", protocol, transport, vehicleInfo, { type: "websocket" });
  return {
    heartbeat: (armed: boolean) => protocol.emitHeartbeat(armed, "AUTO"),
    linkLost: () => fireLinkLost?.(),
  };
}

const hasBadge = (container: HTMLElement, key: string) =>
  container.querySelector(`[data-testid='hud-alert-${key}']`) !== null;

function pushBattery(remaining: number, ageMs: number) {
  useTelemetryStore.getState().pushBattery({
    timestamp: Date.now() - ageMs,
    voltage: 14.2,
    current: 9,
    remaining,
    consumed: 1800,
  });
}

function pushFenceBreach(ageMs: number) {
  useTelemetryStore.getState().pushFenceStatus({
    timestamp: Date.now() - ageMs,
    breachStatus: 1,
    breachCount: 2,
    breachType: 1,
  });
}

describe("HUD corner alerts", () => {
  beforeEach(() => {
    cleanup();
    useDroneManager.getState().clear();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("raises a critical battery badge from a fresh reading", () => {
    pushBattery(9, 0);
    const { container } = renderAlerts();
    expect(container.querySelector("[data-testid='hud-alert-battCrit']")).not.toBeNull();
    expect(container.textContent).toContain(messages.cockpit.alerts.battCrit);
  });

  it("distinguishes low from critical", () => {
    pushBattery(20, 0);
    const { container } = renderAlerts();
    expect(container.querySelector("[data-testid='hud-alert-battLow']")).not.toBeNull();
    expect(container.querySelector("[data-testid='hud-alert-battCrit']")).toBeNull();
  });

  it("drops the battery claim once the reading goes stale", () => {
    pushBattery(9, TELEMETRY_STALE_MS + 1_000);
    const { container } = renderAlerts();

    // Still in the ring, deliberately not asserted on screen.
    expect(useTelemetryStore.getState().battery.latest()?.remaining).toBe(9);
    expect(container.querySelector("[data-testid='hud-alert-battCrit']")).toBeNull();
  });

  it("drops a fence breach claim once the reading goes stale", () => {
    pushFenceBreach(0);
    const fresh = renderAlerts();
    expect(fresh.container.querySelector("[data-testid='hud-alert-fenceBreach']")).not.toBeNull();
    fresh.unmount();

    pushFenceBreach(TELEMETRY_STALE_MS + 1_000);
    const stale = renderAlerts();
    expect(stale.container.querySelector("[data-testid='hud-alert-fenceBreach']")).toBeNull();
  });

  it("reads an FC-reported -1 battery percentage as unknown, not critical", () => {
    pushBattery(-1, 0);
    const { container } = renderAlerts();
    expect(hasBadge(container, "battCrit")).toBe(false);
    expect(hasBadge(container, "battLow")).toBe(false);
  });

  it("raises the stale badge for an armed drone whose heartbeats stop", async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const drone = await connectDrone("drone-armed");
    drone.heartbeat(true);
    expect(useDroneStore.getState().connectionState).toBe("armed");

    const fresh = renderAlerts();
    expect(hasBadge(fresh.container, "linkStale")).toBe(false);
    fresh.unmount();

    // Heartbeats stop; the adapter has not declared the link lost yet.
    vi.setSystemTime(1_000_000 + TELEMETRY_STALE_MS + 500);
    const quiet = renderAlerts();
    expect(hasBadge(quiet.container, "linkStale")).toBe(true);
    expect(quiet.container.textContent).toContain(messages.cockpit.alerts.linkStale);
    quiet.unmount();

    // The adapter declares the link lost: connection state goes
    // "disconnected" and the badge must stay up.
    act(() => drone.linkLost());
    expect(useDroneStore.getState().connectionState).toBe("disconnected");
    const lost = renderAlerts();
    expect(hasBadge(lost.container, "linkStale")).toBe(true);
  });

  it("stays quiet on a healthy armed link", async () => {
    const drone = await connectDrone("drone-healthy");
    drone.heartbeat(true);
    pushBattery(80, 0);
    const { container } = renderAlerts();
    expect(container.textContent).toBe("");
  });

  it("says nothing about staleness on a link that never connected", () => {
    const { container } = renderAlerts();
    expect(hasBadge(container, "linkStale")).toBe(false);
  });

  it("drops the stale badge once the drone is disconnected and deselected", async () => {
    vi.useFakeTimers({ now: 2_000_000 });
    const drone = await connectDrone("drone-gone");
    drone.heartbeat(false);
    vi.setSystemTime(2_000_000 + TELEMETRY_STALE_MS + 500);
    useDroneManager.getState().disconnectDrone("drone-gone");
    const { container } = renderAlerts();
    expect(hasBadge(container, "linkStale")).toBe(false);
  });

  it("does not age the previous drone's heartbeat into a stale badge for a newly selected drone", async () => {
    vi.useFakeTimers({ now: 4_000_000 });
    const first = await connectDrone("drone-first");
    first.heartbeat(true);
    await connectDrone("drone-second");
    useDroneManager.getState().selectDrone("drone-second");
    vi.setSystemTime(4_000_000 + TELEMETRY_STALE_MS + 500);
    const { container } = renderAlerts();
    expect(hasBadge(container, "linkStale")).toBe(false);
  });

  it("reports the stale link instead of an obsolete battery claim", async () => {
    // The realistic link loss: the last battery sample said critical, and then
    // the link died. The operator must be told the link is stale, not shown a
    // battery assertion the GCS can no longer stand behind.
    vi.useFakeTimers({ now: 3_000_000 });
    const drone = await connectDrone("drone-battery");
    drone.heartbeat(true);
    pushBattery(9, 0);
    vi.setSystemTime(3_000_000 + TELEMETRY_STALE_MS + 5_000);
    const { container } = renderAlerts();
    expect(hasBadge(container, "linkStale")).toBe(true);
    expect(hasBadge(container, "battCrit")).toBe(false);
  });
});
