/**
 * The fleet is derived from the node registry on read. A component selecting
 * only summary fields must not re-render when a drone's position moves, and a
 * component selecting the whole fleet must.
 * @license GPL-3.0-only
 */

import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useNodeRegistryStore } from "@/stores/node-registry";
import {
  fleetSummaryEqual,
  getFleetDrones,
  selectFleet,
  useFleetDrones,
} from "@/stores/node-registry/use-fleet-drones";
import type { PositionData } from "@/lib/types";

function pos(lat: number): PositionData {
  return {
    lat,
    lon: 2,
    alt: 100,
    relativeAlt: 50,
    heading: 0,
    groundSpeed: 0,
    airSpeed: 0,
    climbRate: 0,
    timestamp: Date.now(),
  };
}

function nextFrame(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  requestAnimationFrame(() => resolve());
  return promise;
}

beforeEach(() => {
  const reg = useNodeRegistryStore.getState();
  reg.clear();
  reg.upsertPresence("node:a", { deviceId: "a", name: "Alpha", lastHeartbeat: Date.now() }, "local");
  reg.attachFc("node:a", "node:a");
});

describe("useFleetDrones", () => {
  it("projects registry rows for imperative readers", () => {
    expect(getFleetDrones().map((d) => d.name)).toEqual(["Alpha"]);
  });

  it("re-renders a summary consumer only when a summary field changes", async () => {
    let summaryRenders = 0;
    let mapRenders = 0;
    renderHook(() => {
      summaryRenders++;
      return useFleetDrones(selectFleet, fleetSummaryEqual);
    });
    renderHook(() => {
      mapRenders++;
      return useFleetDrones();
    });
    const summaryBase = summaryRenders;
    const mapBase = mapRenders;

    await act(async () => {
      useNodeRegistryStore.getState().updateFcTelemetry("node:a", { position: pos(10) });
      await nextFrame();
    });
    expect(mapRenders).toBeGreaterThan(mapBase);
    expect(summaryRenders).toBe(summaryBase);

    await act(async () => {
      useNodeRegistryStore.getState().updateFcTelemetry("node:a", { flightMode: "AUTO" });
      await nextFrame();
    });
    expect(summaryRenders).toBeGreaterThan(summaryBase);
  });
});
