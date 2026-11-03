/**
 * @license GPL-3.0-only
 *
 * The Map tab's status card: the empty, stale and full states, and the
 * formatting of memory, upload and stream.
 */

import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

import messages from "../../../../../locales/en.json";
import { MapStatusCard } from "@/components/drone-detail/map/MapStatusCard";
import { MAP_STATUS_STALE_MS, mapStatusView } from "@/components/drone-detail/map/map-status-view";
import type { MapStatus, NavHealth } from "@/lib/agent/nav-types";

const NOW = 1_000_000;

const FULL: MapStatus = {
  sessionId: "s-0042",
  placement: "hybrid",
  memoryUsedMb: 512,
  memoryBudgetMb: 1024,
  voxelM: 0.05,
  keyframesDropped: 3,
  sweepPoints: 125000,
  areaM2: 84.25,
  navPose: "always",
  upload: { state: "uploading", bytesDone: 250, bytesTotal: 1000 },
  stream: { state: "live", bytesPerS: 2 * 1024 * 1024 },
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
    expect(text).toContain("s-0042");
    expect(text).toContain((125000).toLocaleString());
    expect(text).toContain("84.3 m²");
    expect(text).toContain("GOOD");
    expect(text).toContain("Hybrid");
    expect(text).toContain("512 / 1024 MB");
    expect(text).toContain("5 cm");
    expect(text).toContain("Always");
    expect(text).toContain("Uploading 25%");
    expect(text).toContain("Live · 2.0 MB/s");
    expect(text).not.toContain(messages.hud.mapTab.stale);
  });

  it("marks a status older than the stale threshold and keeps its values", () => {
    const { container } = renderCard({ data: FULL, receivedAt: NOW - MAP_STATUS_STALE_MS - 1 });
    expect(container.querySelector("section")?.getAttribute("data-state")).toBe("stale");
    expect(container.textContent).toContain(messages.hud.mapTab.stale);
    expect(container.textContent).toContain("s-0042");
    expect(container.textContent).toContain(messages.hud.mapTab.noPose);
  });

  it("shows absent fields as dashes and no session explicitly", () => {
    const sparse: MapStatus = {
      ...FULL,
      sessionId: null,
      memoryUsedMb: null,
      upload: null,
      stream: null,
      navPose: null,
      placement: null,
    };
    const { container } = renderCard({ data: sparse, receivedAt: NOW });
    const text = container.textContent ?? "";
    expect(text).toContain(messages.hud.mapTab.noSession);
    expect(text).not.toContain(messages.hud.mapTab.upload);
    expect(text).not.toContain(messages.hud.mapTab.stream);
  });
});

describe("mapStatusView", () => {
  it("computes the memory fraction and a zero-byte upload as 0 %", () => {
    const v = mapStatusView(
      { data: { ...FULL, upload: { state: "queued", bytesDone: 0, bytesTotal: 0 } }, receivedAt: NOW },
      NOW,
    );
    expect(v.memoryFraction).toBe(0.5);
    expect(v.uploadPct).toBe(0);
  });
});
