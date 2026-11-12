/**
 * @module overview/drone-overview-fc-band.test
 * @description The drone Overview's FC band holds the vehicle readouts, the
 * FC status messages and, without a CRSF lane, the RC channel card.
 * @license GPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { render, screen, cleanup } from "@testing-library/react";

// Several stores under the overview are persisted; bind a deterministic
// in-memory localStorage before the store modules resolve the global.
vi.hoisted(() => {
  const mem = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: {
      getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
      clear: () => mem.clear(),
      key: (i: number) => Array.from(mem.keys())[i] ?? null,
      get length() {
        return mem.size;
      },
    },
  });
});


// The vehicle cards read live stores of their own; stand them in so this test
// pins only where the Overview places them.
vi.mock("@/components/flight/CompactInfoCards", () => ({
  CompactInfoCards: () => <div data-testid="info-cards" />,
}));
vi.mock("@/components/command/shared/StatusTextCard", () => ({
  StatusTextCard: () => <div data-testid="status-text-card" />,
}));
vi.mock("@/components/command/shared/RcInputCard", () => ({
  RcInputCard: () => <div data-testid="rc-input-card" />,
}));

import messages from "../../../../../locales/en.json";
import { DroneOverview } from "../DroneOverview";
import type { SurfaceContext } from "@/components/dashboard/node-detail/surface-types";
import { useDroneManager, type ManagedDrone } from "@/stores/drone-manager";

const NODE_ID = "node:drone-a";
const DEVICE = "drone-a";

/** A relay-carried drone whose transport reports it may publish. */
function seedRelayDrone() {
  const managed = {
    id: NODE_ID,
    name: "Drone A",
    transport: { type: "mqtt-mavlink", canCommand: true },
  } as unknown as ManagedDrone;
  useDroneManager.setState({
    drones: new Map([[NODE_ID, managed]]),
    selectedDroneId: NODE_ID,
  });
}

function ctx(crsfPresent: "present" | "absent"): SurfaceContext {
  return {
    droneId: NODE_ID,
    drone: { _id: NODE_ID, deviceId: DEVICE, name: "Drone A" },
    displayName: "Drone A",
    isConnected: true,
    firmwareType: null,
    agentDeviceId: null,
    agentIdentityKnown: false,
    relayReach: null,
    fcLinking: false,
    radioPresent: "absent",
    visionPresent: "absent",
    crsfPresent,
    gnssPresent: "absent",
    loraPresent: "absent",
    role: "drone",
    capabilitiesKnown: true,
    showLockedTabs: false,
  } as unknown as SurfaceContext;
}

function renderOverview(crsfPresent: "present" | "absent") {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <DroneOverview ctx={ctx(crsfPresent)} />
    </NextIntlClientProvider>,
  );
}


describe("drone Overview FC band", () => {
  afterEach(() => {
    cleanup();
    useDroneManager.setState({ drones: new Map(), selectedDroneId: null });
  });

  it("carries the vehicle readouts, status text and RC card the Flight tab used to show", () => {
    seedRelayDrone();
    renderOverview("absent");
    expect(screen.getByTestId("info-cards")).toBeTruthy();
    expect(screen.getByTestId("status-text-card")).toBeTruthy();
    expect(screen.getByTestId("rc-input-card")).toBeTruthy();
  });

  it("leaves RC to the RC/ELRS tab when the node has its own CRSF lane", () => {
    seedRelayDrone();
    renderOverview("present");
    expect(screen.getByTestId("info-cards")).toBeTruthy();
    expect(screen.queryByTestId("rc-input-card")).toBeNull();
  });
});
