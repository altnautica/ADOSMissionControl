/**
 * @license GPL-3.0-only
 *
 * The RTH chip's distance from home comes from the paired agent's
 * `home_distance` while its telemetry is current, else from the GCS's own
 * global position against HOME_POSITION.
 */

import { afterEach, describe, expect, it } from "vitest";

import { chipHomeDistance } from "@/lib/cockpit/home-distance";
import { useCommandFleetStore, type CommandCloudStatus } from "@/stores/command-fleet-store";

const NOW = 1_000_000;
const DEVICE = "home-dist-dev";
const DRONE = `node:${DEVICE}`;

function setStatus(telemetry: Record<string, unknown>, updatedAt: number) {
  useCommandFleetStore.setState({
    cloudStatuses: { [DEVICE]: { deviceId: DEVICE, updatedAt, telemetry } as unknown as CommandCloudStatus },
    telemetryByDeviceId: {},
  });
}

afterEach(() => {
  useCommandFleetStore.setState({ cloudStatuses: {}, telemetryByDeviceId: {} });
});

describe("chip home distance", () => {
  it("uses the paired agent's home_distance with no global position", () => {
    setStatus({ home_distance: 42.5 }, NOW - 500);
    expect(chipHomeDistance(DRONE, NOW, null, null)).toBe(42.5);
  });

  it("prefers the agent's value over the computed one", () => {
    setStatus({ home_distance: 12 }, NOW - 500);
    const d = chipHomeDistance(DRONE, NOW, { lat: 12.97, lon: 77.59 }, { lat: 12.98, lon: 77.59 });
    expect(d).toBe(12);
  });

  it("falls back to the computed distance when the agent's telemetry is stale", () => {
    setStatus({ home_distance: 12 }, NOW - 10_000);
    const d = chipHomeDistance(DRONE, NOW, { lat: 12.97, lon: 77.59 }, { lat: 12.98, lon: 77.59 });
    expect(d).toBeGreaterThan(1000);
  });

  it("falls back for a drone with no agent", () => {
    expect(chipHomeDistance("fc:direct", NOW, null, null)).toBeNull();
  });
});
