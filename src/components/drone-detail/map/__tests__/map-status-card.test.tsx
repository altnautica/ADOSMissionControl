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
import {
  MAP_STATUS_HEARTBEAT_STALE_MS,
  MAP_STATUS_STREAM_STALE_MS,
  mapStatusView,
} from "@/components/drone-detail/map/map-status-view";
import { specString } from "@/lib/cockpit/spec-strings";
import type { MapStatus, NavHealth } from "@/lib/hud/nav-types";

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
    expect(text).toContain(`${specString("map.status.upload.uploading")} 25%`);
    expect(text).toContain(`${specString("map.status.stream.live")} · 16.8 Mbit/s`);
    expect(text).not.toContain("STALE");
  });

  it("marks a status older than the stale threshold and keeps its values", () => {
    const { container } = renderCard({ data: FULL, receivedAt: NOW - MAP_STATUS_STREAM_STALE_MS - 1000 });
    expect(container.querySelector("section")?.getAttribute("data-state")).toBe("stale");
    expect(container.textContent).toContain(
      specString("map.panel.stale", { s: Math.floor((MAP_STATUS_STREAM_STALE_MS + 1000) / 1000) }),
    );
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
    expect(text).not.toContain(specString("map.status.upload"));
    expect(text).not.toContain(specString("map.status.live_stream"));
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
    const v = mapStatusView(
      {
        data: {
          ...FULL,
          keyframesDropped: 1,
          upload: { state: "failed", bytesDone: 0, bytesTotal: 10 },
          stream: { state: "degraded", bytesPerS: 1000 },
        },
        receivedAt: NOW,
      },
      NOW,
    );
    expect(v.keyframesTone).toBe("warn");
    expect(v.uploadTone).toBe("crit");
    expect(v.streamTone).toBe("warn");
    expect(mapStatusView({ data: { ...FULL, keyframesDropped: 0 }, receivedAt: NOW }, NOW).keyframesTone).toBe("ok");
  });

  it("uses the shared spec words for placement", () => {
    const { container } = renderCard({ data: { ...FULL, placement: "stream" }, receivedAt: NOW });
    expect(container.textContent).toContain(specString("map.status.placement.stream"));
    expect(container.textContent).toContain(specString("map.status.placement"));
  });
});
