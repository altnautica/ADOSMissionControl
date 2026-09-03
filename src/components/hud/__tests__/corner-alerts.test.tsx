/**
 * @module hud/corner-alerts.test
 * @description The HUD corner badges must describe the aircraft now, and the
 * stale badge must actually be reachable.
 *
 * Two inversions are pinned:
 *
 * - The battery and fence badges read `latest()` raw, so "FENCE BREACH" or
 *   "BATT CRIT" stayed on screen for as long as the tab was open after a link
 *   loss, asserting a vehicle state nobody had heard about since.
 * - "LINK STALE" is the one badge whose entire job is to appear when
 *   telemetry stops, and it was the one that could not: its age check sat in a
 *   memo with no time-passing dependency, so once the link died nothing
 *   re-rendered and the badge never showed.
 *
 * @license GPL-3.0-only
 */

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextIntlClientProvider } from "next-intl";

import messages from "../../../../locales/en.json";
import { CornerAlerts } from "@/components/hud/CornerAlerts";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useDroneStore } from "@/stores/drone-store";
import { TELEMETRY_STALE_MS } from "@/lib/telemetry/freshness";

function renderAlerts() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <CornerAlerts />
    </NextIntlClientProvider>,
  );
}

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
    useDroneStore.setState({ connectionState: "disconnected", lastHeartbeat: 0 });
  });
  afterEach(cleanup);

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

  it("raises the stale badge on a link that has gone quiet", () => {
    useDroneStore.setState({
      connectionState: "connected",
      lastHeartbeat: Date.now() - (TELEMETRY_STALE_MS + 2_000),
    });
    const { container } = renderAlerts();
    expect(container.querySelector("[data-testid='hud-alert-linkStale']")).not.toBeNull();
    expect(container.textContent).toContain(messages.cockpit.alerts.linkStale);
  });

  it("stays quiet on a healthy link", () => {
    useDroneStore.setState({ connectionState: "connected", lastHeartbeat: Date.now() });
    pushBattery(80, 0);
    const { container } = renderAlerts();
    expect(container.textContent).toBe("");
  });

  it("says nothing about staleness on a link that never connected", () => {
    useDroneStore.setState({ connectionState: "disconnected", lastHeartbeat: 0 });
    const { container } = renderAlerts();
    expect(container.querySelector("[data-testid='hud-alert-linkStale']")).toBeNull();
  });

  it("reports the stale link instead of an obsolete battery claim", () => {
    // The realistic link loss: the last battery sample said critical, and then
    // the link died. The operator must be told the link is stale, not shown a
    // battery assertion the GCS can no longer stand behind.
    pushBattery(9, TELEMETRY_STALE_MS + 5_000);
    useDroneStore.setState({
      connectionState: "connected",
      lastHeartbeat: Date.now() - (TELEMETRY_STALE_MS + 5_000),
    });
    const { container } = renderAlerts();
    expect(container.querySelector("[data-testid='hud-alert-linkStale']")).not.toBeNull();
    expect(container.querySelector("[data-testid='hud-alert-battCrit']")).toBeNull();
  });
});
