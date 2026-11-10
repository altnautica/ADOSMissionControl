/**
 * @license GPL-3.0-only
 *
 * The right column on a vehicle's MAVLink camera: the zoom button names the
 * camera step it takes (in, then out at the end of the travel) instead of a
 * digital factor, and a refused photo or zoom says why.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";

import { renderWithIntl } from "../../../../../tests/helpers/intl-wrapper";
import type { CommandResult, DroneProtocol } from "@/lib/protocol/types";

vi.mock("@/lib/agent/resolve-agent", () => ({
  resolveLocalAgentForDrone: () => ({ agentUrl: "http://agent.test", apiKey: "k" }),
}));

const shot = vi.fn<() => Promise<Blob | null>>();
vi.mock("@/lib/video/webrtc-client", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  captureScreenshot: () => shot(),
}));

const notify = vi.fn();
vi.mock("@/lib/skills/registry", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  notifySkill: (...a: unknown[]) => notify(...a),
}));

vi.mock("@/hooks/use-ds4-dispatcher", () => ({ firePluginSkill: () => false }));

import { RightColumn } from "../RightColumn";
import { FlightGridContext } from "../flight-context";
import { flightGrid } from "../flight-grid";
import { useViewZoomStore } from "../view-zoom-store";
import { useDroneManager } from "@/stores/drone-manager";
import { VEHICLE_ZOOM_STEPS, useMavlinkCameraStore } from "@/stores/mavlink-camera-store";

const grid = flightGrid({ width: 1280, height: 800, widthClass: "expanded" });

let answer: CommandResult = { success: true, resultCode: 0, message: "Accepted" };
const sent: string[] = [];

beforeEach(() => {
  answer = { success: true, resultCode: 0, message: "Accepted" };
  sent.length = 0;
  shot.mockReset();
  notify.mockReset();
  useViewZoomStore.setState({ byDrone: {} });
  useMavlinkCameraStore.setState({ byDrone: {}, zoomByDrone: {} });
  const protocol = {
    imageStartCapture: async () => {
      sent.push("capture");
      return answer;
    },
    setCameraZoom: async (step: 1 | -1) => {
      sent.push(`zoom ${step}`);
      return answer;
    },
  } as Partial<DroneProtocol> as DroneProtocol;
  useDroneManager.setState({ drones: new Map([["cam-drone", { protocol }]]) } as never);
  useMavlinkCameraStore.getState().setCamera("cam-drone", { capture: true, zoom: true });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ available: false }), { status: 200 })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useDroneManager.setState({ drones: new Map() });
});

async function renderColumn(): Promise<void> {
  renderWithIntl(
    <FlightGridContext.Provider value={grid}>
      <RightColumn droneId="cam-drone" />
    </FlightGridContext.Provider>,
  );
  await act(async () => {});
}

describe("right column on a vehicle camera", () => {
  it("names the camera step on the zoom button and turns back at the end of the travel", async () => {
    await renderColumn();
    const zoom = screen.getByTestId("fs-zoom");
    expect(zoom.getAttribute("aria-label")).toBe("Zoom in");
    expect(zoom.textContent).not.toContain("×");
    for (let i = 0; i < VEHICLE_ZOOM_STEPS; i += 1) {
      await act(async () => {
        fireEvent.click(zoom);
      });
    }
    expect(zoom.getAttribute("aria-label")).toBe("Zoom out");
    await act(async () => {
      fireEvent.click(zoom);
    });
    expect(sent).toEqual([...Array<string>(VEHICLE_ZOOM_STEPS).fill("zoom 1"), "zoom -1"]);
    expect(useViewZoomStore.getState().byDrone["cam-drone"]).toBeUndefined();
  });

  it("says why a refused zoom step failed", async () => {
    answer = { success: false, resultCode: 2, message: "Denied" };
    await renderColumn();
    await act(async () => {
      fireEvent.click(screen.getByTestId("fs-zoom"));
    });
    expect(notify).toHaveBeenLastCalledWith("Zoom failed: Denied", "warning");
    expect(screen.getByTestId("fs-zoom").getAttribute("aria-label")).toBe("Zoom in");
  });

  it("says why a refused photo failed and grabs no frame in its place", async () => {
    answer = { success: false, resultCode: 4, message: "Failed" };
    await renderColumn();
    await act(async () => {
      fireEvent.click(screen.getByTestId("fs-shutter"));
    });
    expect(sent).toEqual(["capture"]);
    expect(shot).not.toHaveBeenCalled();
    expect(notify).toHaveBeenLastCalledWith("Photo failed: Failed", "warning");
  });
});
