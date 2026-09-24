/**
 * @license GPL-3.0-only
 *
 * Tests for the generic per-plugin cloud-state store: the heartbeat's opaque
 * pluginState[pluginId] slices keyed by device, with the slice selector.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  usePluginCloudStateStore,
  selectPluginCloudSlice,
} from "../plugin-cloud-state-store";

beforeEach(() => {
  usePluginCloudStateStore.setState({ byDevice: {}, updatedAt: {} });
});

describe("usePluginCloudStateStore", () => {
  it("stores a device's plugin slices and selects one opaquely", () => {
    usePluginCloudStateStore.getState().setForDevice(
      "dev-1",
      { mapper: { state: "mapping", pointCount: 99 }, "follow-me": { lock: "locked" } },
      1,
    );
    const mapper = selectPluginCloudSlice("dev-1", "mapper")(
      usePluginCloudStateStore.getState(),
    );
    expect(mapper).toEqual({ state: "mapping", pointCount: 99 });
    expect(
      selectPluginCloudSlice("dev-1", "follow-me")(usePluginCloudStateStore.getState()),
    ).toEqual({ lock: "locked" });
  });

  it("returns undefined for an unknown device or plugin", () => {
    usePluginCloudStateStore.getState().setForDevice("dev-1", { mapper: { x: 1 } }, 1);
    expect(
      selectPluginCloudSlice("dev-2", "mapper")(usePluginCloudStateStore.getState()),
    ).toBeUndefined();
    expect(
      selectPluginCloudSlice("dev-1", "thermal")(usePluginCloudStateStore.getState()),
    ).toBeUndefined();
    expect(
      selectPluginCloudSlice(null, "mapper")(usePluginCloudStateStore.getState()),
    ).toBeUndefined();
  });

  it("replaces a device's whole map on each heartbeat (no stale merge)", () => {
    const s = usePluginCloudStateStore.getState();
    s.setForDevice("dev-1", { mapper: { a: 1 }, thermal: { t: 1 } }, 1);
    s.setForDevice("dev-1", { mapper: { a: 2 } }, 2); // thermal dropped this tick
    expect(
      selectPluginCloudSlice("dev-1", "thermal")(usePluginCloudStateStore.getState()),
    ).toBeUndefined();
    expect(
      selectPluginCloudSlice("dev-1", "mapper")(usePluginCloudStateStore.getState()),
    ).toEqual({ a: 2 });
  });

  it("clears one device without touching others", () => {
    const s = usePluginCloudStateStore.getState();
    s.setForDevice("dev-1", { mapper: { a: 1 } }, 1);
    s.setForDevice("dev-2", { mapper: { a: 2 } }, 1);
    s.clearDevice("dev-1");
    expect(usePluginCloudStateStore.getState().byDevice["dev-1"]).toBeUndefined();
    expect(usePluginCloudStateStore.getState().byDevice["dev-2"]).toEqual({
      mapper: { a: 2 },
    });
  });
});
