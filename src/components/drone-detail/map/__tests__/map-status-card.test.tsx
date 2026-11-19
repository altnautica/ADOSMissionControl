/**
 * @license GPL-3.0-only
 *
 * The Map tab's status card: the empty, stale and full states, and the
 * formatting of memory, the pose provider and the FC IMU feed.
 */

import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

import messages from "../../../../../locales/en.json";
import { MapStatusCard } from "@/components/drone-detail/map/MapStatusCard";
import {
  MAP_STATUS_HEARTBEAT_STALE_MS,
  MAP_STATUS_STREAM_STALE_MS,
  mapStatusView,
} from "@/components/drone-detail/map/map-status-view";
import { specString } from "@/lib/cockpit/spec-strings";
import type { MapStatus, NavHealth } from "@/lib/hud/nav-types";

const NOW = 1_000_000;

const FULL: MapStatus = {
  placement: "hybrid",
  memoryUsedMb: 512,
  memoryBudgetMb: 1024,
  voxelM: 0.05,
  sweepPoints: 125000,
  areaM2: 84.25,
  poseProvider: "lidar_planar",
  imuFeed: { state: "ok", reason: null, rateHz: 49.7 },
};

function renderCard(entry: { data: MapStatus; receivedAt: number } | null, poseHealth: NavHealth | null = null) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <MapStatusCard view={mapStatusView(entry, NOW)} poseHealth={poseHealth} />
    </NextIntlClientProvider>,
  );
}

describe("MapStatusCard", () => {
  it("states explicitly that no map data has arrived", () => {
    const { container } = renderCard(null);
    expect(container.querySelector("section")?.getAttribute("data-state")).toBe("empty");
    expect(container.textContent).toContain(messages.hud.mapTab.noData);
    expect(container.querySelector("dl")).toBeNull();
  });

  it("renders every field of a fresh status", () => {
    const { container } = renderCard({ data: FULL, receivedAt: NOW - 500 }, "good");
    const text = container.textContent ?? "";
    expect(container.querySelector("section")?.getAttribute("data-state")).toBe("live");
    expect(text).toContain((125000).toLocaleString());
    expect(text).toContain("84.3 m²");
    expect(text).toContain("GOOD");
    expect(text).toContain("Hybrid");
    expect(text).toContain("512 / 1024 MB");
    expect(text).toContain("5 cm");
    expect(text).toContain(specString("map.status.pose_provider.lidar_planar"));
    expect(text).toContain(`${specString("map.status.imu_feed.ok")} · 50 Hz`);
    expect(text).not.toContain("STALE");
  });

  it("marks a status older than the stale threshold and keeps its values", () => {
    const { container } = renderCard({ data: FULL, receivedAt: NOW - MAP_STATUS_STREAM_STALE_MS - 1000 });
    expect(container.querySelector("section")?.getAttribute("data-state")).toBe("stale");
    expect(container.textContent).toContain(
      specString("map.panel.stale", { s: Math.floor((MAP_STATUS_STREAM_STALE_MS + 1000) / 1000) }),
    );
    expect(container.textContent).toContain("Hybrid");
    expect(container.textContent).toContain(messages.hud.mapTab.noPose);
  });

  it("shows absent fields as dashes and no IMU feed row without a feed", () => {
    const sparse: MapStatus = { ...FULL, memoryUsedMb: null, placement: null, poseProvider: null, imuFeed: null };
    const { container } = renderCard({ data: sparse, receivedAt: NOW });
    const text = container.textContent ?? "";
    expect(text).toContain("—");
    expect(text).not.toContain(specString("map.status.imu_feed"));
  });

  it("names the compute node a streamed map comes from, and only then", () => {
    const entry = { data: { ...FULL, placement: "stream" as const }, receivedAt: NOW };
    const { container, rerender } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <MapStatusCard view={mapStatusView(entry, NOW)} poseHealth={null} stream={{ node: "Forge", state: "live" }} />
      </NextIntlClientProvider>,
    );
    expect(container.textContent).toContain(messages.hud.mapTab.streamSource);
    expect(container.textContent).toContain("Forge · live");
    rerender(
      <NextIntlClientProvider locale="en" messages={messages}>
        <MapStatusCard view={mapStatusView(entry, NOW)} poseHealth={null} stream={{ node: "Forge", state: "unreachable" }} />
      </NextIntlClientProvider>,
    );
    expect(container.querySelector("[data-stream-state='unreachable']")?.textContent).toBe(
      "Forge · not reachable from this browser",
    );
    rerender(
      <NextIntlClientProvider locale="en" messages={messages}>
        <MapStatusCard view={mapStatusView(entry, NOW)} poseHealth={null} />
      </NextIntlClientProvider>,
    );
    expect(container.textContent).not.toContain(messages.hud.mapTab.streamSource);
  });
});

describe("mapStatusView", () => {
  it("computes the memory fraction", () => {
    expect(mapStatusView({ data: FULL, receivedAt: NOW }, NOW).memoryFraction).toBe(0.5);
  });

  it("uses the stream budget for nav-stream entries and the longer one for the heartbeat slice", () => {
    const entry = { data: FULL, receivedAt: NOW - MAP_STATUS_STREAM_STALE_MS - 1 };
    expect(mapStatusView(entry, NOW, "stream").state).toBe("stale");
    expect(mapStatusView(entry, NOW, "heartbeat").state).toBe("live");
    expect(
      mapStatusView({ data: FULL, receivedAt: NOW - MAP_STATUS_HEARTBEAT_STALE_MS - 1 }, NOW, "heartbeat").state,
    ).toBe("stale");
  });

  it("shares the agent's warn and critical tones", () => {
    const at = (used: number) =>
      mapStatusView({ data: { ...FULL, memoryUsedMb: used, memoryBudgetMb: 100 }, receivedAt: NOW }, NOW).memoryTone;
    expect(at(84)).toBe("ok");
    expect(at(85)).toBe("warn");
    expect(at(95)).toBe("crit");
    const imu = (state: "ok" | "degraded" | "lost") =>
      mapStatusView({ data: { ...FULL, imuFeed: { state, reason: null, rateHz: null } }, receivedAt: NOW }, NOW)
        .imuTone;
    expect(imu("ok")).toBe("ok");
    expect(imu("degraded")).toBe("warn");
    expect(imu("lost")).toBe("crit");
  });

  it("uses the shared spec words for placement", () => {
    const { container } = renderCard({ data: { ...FULL, placement: "stream" }, receivedAt: NOW });
    expect(container.textContent).toContain(specString("map.status.placement.stream"));
    expect(container.textContent).toContain(specString("map.status.placement"));
  });
});
