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
      { atlas: { state: "capturing", gaussianCount: 99 }, "follow-me": { lock: "locked" } },
      1,
    );
    const atlas = selectPluginCloudSlice("dev-1", "atlas")(
      usePluginCloudStateStore.getState(),
    );
    expect(atlas).toEqual({ state: "capturing", gaussianCount: 99 });
    expect(
      selectPluginCloudSlice("dev-1", "follow-me")(usePluginCloudStateStore.getState()),
    ).toEqual({ lock: "locked" });
  });

  it("returns undefined for an unknown device or plugin", () => {
    usePluginCloudStateStore.getState().setForDevice("dev-1", { atlas: { x: 1 } }, 1);
    expect(
      selectPluginCloudSlice("dev-2", "atlas")(usePluginCloudStateStore.getState()),
    ).toBeUndefined();
    expect(
      selectPluginCloudSlice("dev-1", "thermal")(usePluginCloudStateStore.getState()),
    ).toBeUndefined();
    expect(
      selectPluginCloudSlice(null, "atlas")(usePluginCloudStateStore.getState()),
    ).toBeUndefined();
  });

  it("replaces a device's whole map on each heartbeat (no stale merge)", () => {
    const s = usePluginCloudStateStore.getState();
    s.setForDevice("dev-1", { atlas: { a: 1 }, thermal: { t: 1 } }, 1);
    s.setForDevice("dev-1", { atlas: { a: 2 } }, 2); // thermal dropped this tick
    expect(
      selectPluginCloudSlice("dev-1", "thermal")(usePluginCloudStateStore.getState()),
    ).toBeUndefined();
    expect(
      selectPluginCloudSlice("dev-1", "atlas")(usePluginCloudStateStore.getState()),
    ).toEqual({ a: 2 });
  });

  it("clears one device without touching others", () => {
    const s = usePluginCloudStateStore.getState();
    s.setForDevice("dev-1", { atlas: { a: 1 } }, 1);
    s.setForDevice("dev-2", { atlas: { a: 2 } }, 1);
    s.clearDevice("dev-1");
    expect(usePluginCloudStateStore.getState().byDevice["dev-1"]).toBeUndefined();
    expect(usePluginCloudStateStore.getState().byDevice["dev-2"]).toEqual({
      atlas: { a: 2 },
    });
  });
});
