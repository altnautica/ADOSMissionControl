/**
 * @license GPL-3.0-only
 *
 * The follow target on the tile minimap: drawn about the EKF origin only when
 * both the origin and a fresh `target_ned` are known; coast icon and dashed
 * tick while coasting.
 */

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-leaflet", () => ({
  Marker: ({ position, icon }: { position: [number, number]; icon: { options: { html?: string } } }) => (
    <div data-testid="marker" data-pos={position.join(",")} dangerouslySetInnerHTML={{ __html: icon.options.html ?? "" }} />
  ),
  Polyline: ({ positions, pathOptions }: { positions: [number, number][]; pathOptions: { className?: string } }) => (
    <div data-testid="tick" data-class={pathOptions.className} data-to={positions[1].join(",")} />
  ),
}));

import { FollowTargetGeoLayer } from "@/components/map/local/FollowTargetGeoLayer";
import type { FollowState } from "@/lib/hud/nav-types";
import { nedToLatLon } from "@/lib/nav/ned-geo";
import { useGpsOriginStore } from "@/stores/gps-origin-store";
import { useNavStreamStore } from "@/stores/nav-stream-store";

const DRONE = "node:geo-target-test";
const ORIGIN = { timestamp: 0, lat: 12.97, lon: 77.59, alt: 900 };

const FOLLOW: FollowState = {
  active: true,
  phase: "following",
  trackId: 12,
  confidence: 0.9,
  rangeM: 10,
  rangeSigmaM: 0.3,
  rangeCues: [],
  targetSpeedMps: 1,
  aglM: 5,
  aglSource: "rng",
  reacquireMode: "strict",
  coastRemainingS: null,
  pipelineLatencyMs: 80,
  holdReason: null,
  bearingDeg: 0,
  depressionDeg: 20,
  targetNed: [10, 5],
  targetVelNed: [1, 0],
  predictedBbox: null,
};

describe("FollowTargetGeoLayer", () => {
  beforeEach(() => {
    useGpsOriginStore.getState().clear(DRONE);
    useNavStreamStore.getState().clear(DRONE);
  });
  afterEach(() => cleanup());

  it("draws nothing until the EKF origin is known", () => {
    useNavStreamStore.getState().setFollow(DRONE, FOLLOW);
    const { container } = render(<FollowTargetGeoLayer droneId={DRONE} />);
    expect(container.querySelector("[data-testid='marker']")).toBeNull();
  });

  it("draws nothing without a target position", () => {
    useGpsOriginStore.getState().setOrigin(DRONE, ORIGIN);
    useNavStreamStore.getState().setFollow(DRONE, { ...FOLLOW, targetNed: null });
    const { container } = render(<FollowTargetGeoLayer droneId={DRONE} />);
    expect(container.querySelector("[data-testid='marker']")).toBeNull();
  });

  it("places the target and its tick about the origin while following", () => {
    useGpsOriginStore.getState().setOrigin(DRONE, ORIGIN);
    useNavStreamStore.getState().setFollow(DRONE, FOLLOW);
    const { container } = render(<FollowTargetGeoLayer droneId={DRONE} />);
    const marker = container.querySelector("[data-testid='marker']");
    expect(marker?.getAttribute("data-pos")).toBe(nedToLatLon(ORIGIN, 10, 5).join(","));
    expect(marker?.querySelector("[data-follow-target]")?.getAttribute("data-follow-target")).toBe("track");
    const tick = container.querySelector("[data-testid='tick']");
    expect(tick?.getAttribute("data-to")).toBe(nedToLatLon(ORIGIN, 11, 5).join(","));
    expect(tick?.getAttribute("data-class")).toBe("mmap-tgt-tick");
  });

  it("uses the coast mark while coasting and hides a stale follow state", () => {
    useGpsOriginStore.getState().setOrigin(DRONE, ORIGIN);
    useNavStreamStore.getState().setFollow(DRONE, { ...FOLLOW, phase: "coasting" });
    const { container, unmount } = render(<FollowTargetGeoLayer droneId={DRONE} />);
    expect(container.querySelector("[data-follow-target]")?.getAttribute("data-follow-target")).toBe("coast");
    expect(container.querySelector("[data-testid='tick']")?.getAttribute("data-class")).toBe("mmap-tgt-tick coast");
    unmount();

    useNavStreamStore.getState().setFollow(DRONE, FOLLOW, Date.now() - 5000);
    const stale = render(<FollowTargetGeoLayer droneId={DRONE} />);
    expect(stale.container.querySelector("[data-testid='marker']")).toBeNull();
  });
});
