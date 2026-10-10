/**
 * @module cockpit/cockpit-alerts.test
 * @description The cockpit alert stack must describe the aircraft now, rank
 * what it says, and make the link alert reachable.
 *
 * Pinned:
 *
 * - Battery and fence alerts are drawn from fresh samples only: a "FENCE
 *   BREACH" or "BATT CRIT" must not outlive the link that reported it.
 * - A battery percentage of -1 is the FC saying "capacity unknown", not an
 *   empty pack, and never alerts. Thresholds come from the operator's bands.
 * - The link alert keys on heartbeat age: stale after 3 s (warning), lost
 *   after 10 s while armed (critical). It is driven through the real
 *   drone-manager bridge, where an armed heartbeat leaves the connection state
 *   "armed" and a declared link loss turns it "disconnected".
 * - Critical alerts sit in the assertive live region, the rest in the polite
 *   one, and every alert carries a spoken level, not colour alone.
 *
 * @license GPL-3.0-only
 */

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";

import messages from "../../../../locales/en.json";
import { CockpitAlerts } from "@/components/cockpit/CockpitAlerts";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useDroneStore } from "@/stores/drone-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useVideoStore } from "@/stores/video-store";
import { MockProtocol } from "@/mock/mock-protocol";
import type { Transport } from "@/lib/protocol/types";
import { TELEMETRY_STALE_MS } from "@/lib/telemetry/freshness";
import { LINK_LOST_MS, LINK_STALE_MS } from "@/components/cockpit/band/link-state";

const A = messages.cockpit.alerts;

function renderAlerts(droneId: string) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <CockpitAlerts droneId={droneId} />
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

/** Connect one drone through drone-manager (auto-selected, so the bridge
 * writes the single-slot drone store). */
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
    protocol,
    heartbeat: (armed: boolean) => protocol.emitHeartbeat(armed, "AUTO"),
    linkLost: () => fireLinkLost?.(),
  };
}

const alertEl = (c: HTMLElement, id: string) =>
  c.querySelector<HTMLElement>(`[data-testid='cockpit-alert-${id}']`);
const has = (c: HTMLElement, id: string) => alertEl(c, id) !== null;

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

/** Battery tests need no link; they only need this drone to be the selected one. */
function selectWithoutSession(id: string) {
  useDroneManager.setState({ selectedDroneId: id });
}

describe("cockpit alert stack", () => {
  beforeEach(() => {
    cleanup();
    useDroneManager.getState().clear();
    useVideoStore.getState().clearForSelection();
    useVideoStore.setState({ isStreaming: false });
    useTelemetryStore.getState().clear();
    useDroneStore.setState({ armState: "unknown", armedAt: null, lastHeartbeat: 0, systemStatus: 0 });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("raises a critical battery alert in the assertive region", () => {
    selectWithoutSession("d-batt");
    pushBattery(9, 0);
    const { container } = renderAlerts("d-batt");
    const el = alertEl(container, "battCrit");
    expect(el).not.toBeNull();
    expect(el!.getAttribute("data-level")).toBe("critical");
    expect(el!.closest("[aria-live]")?.getAttribute("aria-live")).toBe("assertive");
    expect(el!.textContent).toContain(A.battCrit);
    expect(el!.textContent).toContain(A.level.critical);
  });

  it("distinguishes low from critical under the operator's bands", () => {
    selectWithoutSession("d-batt");
    pushBattery(25, 0);
    const { container } = renderAlerts("d-batt");
    const el = alertEl(container, "battLow");
    expect(el?.getAttribute("data-level")).toBe("warning");
    expect(el?.closest("[aria-live]")?.getAttribute("aria-live")).toBe("polite");
    expect(has(container, "battCrit")).toBe(false);
  });

  it("drops the battery claim once the reading goes stale", () => {
    selectWithoutSession("d-batt");
    pushBattery(9, TELEMETRY_STALE_MS + 1_000);
    const { container } = renderAlerts("d-batt");
    expect(useTelemetryStore.getState().battery.latest()?.remaining).toBe(9);
    expect(has(container, "battCrit")).toBe(false);
  });

  it("reads an FC-reported -1 battery percentage as unknown, never an alert", () => {
    selectWithoutSession("d-batt");
    pushBattery(-1, 0);
    const { container } = renderAlerts("d-batt");
    expect(has(container, "battCrit")).toBe(false);
    expect(has(container, "battLow")).toBe(false);
  });

  it("drops a fence breach claim once the reading goes stale", () => {
    selectWithoutSession("d-fence");
    pushFenceBreach(0);
    const fresh = renderAlerts("d-fence");
    expect(alertEl(fresh.container, "fenceBreach")?.getAttribute("data-level")).toBe("critical");
    fresh.unmount();
    pushFenceBreach(TELEMETRY_STALE_MS + 1_000);
    const stale = renderAlerts("d-fence");
    expect(has(stale.container, "fenceBreach")).toBe(false);
  });

  it("escalates an armed silent link from stale to lost", async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const drone = await connectDrone("drone-armed");
    drone.heartbeat(true);
    expect(useDroneStore.getState().connectionState).toBe("armed");

    const fresh = renderAlerts("drone-armed");
    expect(has(fresh.container, "linkStale")).toBe(false);
    fresh.unmount();

    vi.setSystemTime(1_000_000 + LINK_STALE_MS + 500);
    const quiet = renderAlerts("drone-armed");
    expect(alertEl(quiet.container, "linkStale")?.getAttribute("data-level")).toBe("warning");
    quiet.unmount();

    vi.setSystemTime(1_000_000 + LINK_LOST_MS + 500);
    const lost = renderAlerts("drone-armed");
    expect(alertEl(lost.container, "linkLost")?.getAttribute("data-level")).toBe("critical");
    expect(lost.container.textContent).toContain(A.linkLost);
    lost.unmount();

    // The adapter declares the link lost; the alert must stay up.
    act(() => drone.linkLost());
    expect(useDroneStore.getState().connectionState).toBe("disconnected");
    const declared = renderAlerts("drone-armed");
    expect(has(declared.container, "linkLost")).toBe(true);
  });

  it("stays quiet on a healthy armed link", async () => {
    const drone = await connectDrone("drone-healthy");
    drone.heartbeat(true);
    pushBattery(80, 0);
    const { container } = renderAlerts("drone-healthy");
    expect(container.textContent).toBe("");
  });

  it("says nothing about staleness on a link that never connected", () => {
    selectWithoutSession("d-none");
    const { container } = renderAlerts("d-none");
    expect(has(container, "linkStale")).toBe(false);
  });

  it("drops the link alert once the drone is disconnected and deselected", async () => {
    vi.useFakeTimers({ now: 2_000_000 });
    const drone = await connectDrone("drone-gone");
    drone.heartbeat(false);
    vi.setSystemTime(2_000_000 + LINK_STALE_MS + 500);
    useDroneManager.getState().disconnectDrone("drone-gone");
    const { container } = renderAlerts("drone-gone");
    expect(has(container, "linkStale")).toBe(false);
  });

  it("does not age the previous drone's heartbeat into the new drone's alert", async () => {
    vi.useFakeTimers({ now: 4_000_000 });
    const first = await connectDrone("drone-first");
    first.heartbeat(true);
    await connectDrone("drone-second");
    useDroneManager.getState().selectDrone("drone-second");
    vi.setSystemTime(4_000_000 + LINK_STALE_MS + 500);
    const { container } = renderAlerts("drone-second");
    expect(has(container, "linkStale")).toBe(false);
  });

  it("reports the lost link instead of an obsolete battery claim", async () => {
    vi.useFakeTimers({ now: 3_000_000 });
    const drone = await connectDrone("drone-battery");
    drone.heartbeat(true);
    pushBattery(9, 0);
    vi.setSystemTime(3_000_000 + LINK_LOST_MS + 500);
    const { container } = renderAlerts("drone-battery");
    expect(has(container, "linkLost")).toBe(true);
    expect(has(container, "battCrit")).toBe(false);
  });

  it("flags an FC-declared emergency state as critical", async () => {
    const drone = await connectDrone("drone-emerg");
    drone.heartbeat(true);
    act(() => useDroneStore.setState({ systemStatus: 6 }));
    const { container } = renderAlerts("drone-emerg");
    expect(alertEl(container, "fcState")?.textContent).toContain(A.fcEmergency);
  });

  it("warns on a frozen picture and on a sub-3D fix while armed", async () => {
    const drone = await connectDrone("drone-warn");
    drone.heartbeat(true);
    useTelemetryStore.getState().pushGps({
      timestamp: Date.now(),
      fixType: 2,
      satellites: 5,
      lat: 0,
      lon: 0,
      alt: 0,
    });
    useVideoStore.setState({ isStreaming: true });
    useVideoStore.getState().setVideoDegraded("no-progress");
    const { container } = renderAlerts("drone-warn");
    expect(alertEl(container, "gpsNo3d")?.getAttribute("data-level")).toBe("warning");
    expect(alertEl(container, "videoFrozen")?.getAttribute("data-level")).toBe("warning");
  });

  it("surfaces critical STATUSTEXT and pre-arm failures from this drone's FC", async () => {
    const drone = await connectDrone("drone-text");
    drone.heartbeat(false);
    const { container } = renderAlerts("drone-text");
    act(() => {
      drone.protocol.emitStatusText(2, "Crash: Disarming");
      drone.protocol.emitStatusText(3, "PreArm: Compass not calibrated");
    });
    expect(alertEl(container, "statusText")?.textContent).toContain("Crash: Disarming");
    const prearm = alertEl(container, "prearm");
    expect(prearm?.getAttribute("data-level")).toBe("advisory");
    expect(prearm?.textContent).toContain("Compass not calibrated");
  });

  it("orders critical before warning before advisory", async () => {
    const drone = await connectDrone("drone-order");
    drone.heartbeat(false);
    pushBattery(9, 0);
    useVideoStore.setState({ isStreaming: true });
    useVideoStore.getState().setVideoDegraded("ice-disconnect");
    const { container } = renderAlerts("drone-order");
    act(() => drone.protocol.emitStatusText(3, "PreArm: Throttle too high"));
    const levels = Array.from(container.querySelectorAll("[data-level]")).map((el) =>
      el.getAttribute("data-level"),
    );
    expect(levels).toEqual(["critical", "warning", "advisory"]);
  });
});
