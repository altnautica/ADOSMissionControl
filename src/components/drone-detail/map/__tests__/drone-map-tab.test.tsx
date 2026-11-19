/**
 * @license GPL-3.0-only
 *
 * The Map tab: Navigation's status card from the nav feed, the 2D live map
 * with the extension overlay layer over it, and the 3D sweep view, the
 * choice kept per drone.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

import messages from "../../../../../locales/en.json";
import { DroneMapTab } from "@/components/drone-detail/map/DroneMapTab";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import { useReconstructStreamStore } from "@/stores/reconstruct-stream-store";
import type { MapStatus } from "@/lib/hud/nav-types";
import type * as WorldStream from "@/lib/api/reconstruct/world-stream";

vi.mock("@/components/drone-detail/map/LiveSweep3D", () => ({
  LiveSweep3D: ({ droneId }: { droneId: string }) => <div data-testid="sweep-stub">{droneId}</div>,
}));

const { startStream, stopStream } = vi.hoisted(() => {
  const stopStream = vi.fn();
  return { stopStream, startStream: vi.fn((_droneId: string) => stopStream) };
});
vi.mock("@/lib/api/reconstruct/world-stream", async (importOriginal) => ({
  ...(await importOriginal<typeof WorldStream>()),
  startReconstructStream: startStream,
}));

const STATUS: MapStatus = {
  placement: "onboard",
  memoryUsedMb: 100,
  memoryBudgetMb: 400,
  voxelM: 0.1,
  sweepPoints: 10,
  areaM2: 2,
  poseProvider: "lidar_planar",
  imuFeed: null,
};

const DRONE = "node:map-tab-test";

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <DroneMapTab droneId={DRONE} />
    </NextIntlClientProvider>,
  );
}

describe("DroneMapTab", () => {
  beforeEach(() => {
    useNavStreamStore.getState().clear(DRONE);
    useReconstructStreamStore.getState().clear(DRONE);
    startStream.mockClear();
    stopStream.mockClear();
  });
  afterEach(() => cleanup());

  it("runs the compute node's stream only while the placement is stream, and names the node", () => {
    useNavStreamStore.getState().setMap(DRONE, STATUS);
    const { container, unmount } = renderTab();
    expect(startStream).not.toHaveBeenCalled();
    act(() => useNavStreamStore.getState().setMap(DRONE, { ...STATUS, placement: "stream" }));
    expect(startStream).toHaveBeenCalledWith(DRONE);
    expect(container.textContent).not.toContain(messages.hud.mapTab.streamSource);
    act(() => useReconstructStreamStore.getState().setStatus(DRONE, "forge-1", "live"));
    expect(container.textContent).toContain("forge-1 · live");
    unmount();
    expect(stopStream).toHaveBeenCalledTimes(1);
  });

  it("shows the empty card, and the 2D map with the overlay layer by default", () => {
    const { container } = renderTab();
    expect(container.textContent).toContain(messages.hud.mapTab.noData);
    expect(container.querySelector(".lfmap")).not.toBeNull();
    expect(container.querySelector("[data-map-layer='plugin-map-overlay']")).not.toBeNull();
  });

  it("renders Navigation's map status", () => {
    useNavStreamStore.getState().setMap(DRONE, {
      placement: "onboard",
      memoryUsedMb: 100,
      memoryBudgetMb: 400,
      voxelM: 0.1,
      sweepPoints: 10,
      areaM2: 2,
      poseProvider: "lidar_planar",
      imuFeed: { state: "degraded", reason: "starved", rateHz: 9 },
    });
    const { container } = renderTab();
    expect(container.textContent).toContain("Planar LiDAR");
    expect(container.textContent).toContain("Degraded · 9 Hz");
  });

  it("switches to the 3D sweep and keeps the choice for the drone", async () => {
    renderTab();
    fireEvent.click(screen.getByRole("radio", { name: messages.hud.mapTab.view3d }));
    expect(await screen.findByTestId("sweep-stub")).toBeTruthy();
    cleanup();
    const { container } = renderTab();
    expect(await screen.findByTestId("sweep-stub")).toBeTruthy();
    expect(container.querySelector(".lfmap")).toBeNull();
  });
});
