/**
 * @license GPL-3.0-only
 *
 * A view that draws detection overlays holds a detection lease on the camera
 * it shows: requested at once, renewed every 2 s for 6 s, released with
 * `hold_s: 0` when the view closes, the camera changes or the page hides.
 * Views on the same camera share one lease. Each window holds its leases under
 * its own owner, so one window's release never cancels another's lease.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const agents = vi.hoisted(() => new Map<string, { agentUrl: string; apiKey: string }>());
const demo = vi.hoisted(() => ({ on: false }));

vi.mock("@/lib/agent/resolve-agent", () => ({
  resolveLocalAgentForDrone: (id: string) => agents.get(id) ?? null,
}));
vi.mock("@/lib/utils", async (orig) => ({
  ...(await orig<typeof import("@/lib/utils")>()),
  isDemoMode: () => demo.on,
}));

import { useDetectionDemand } from "../use-detection-demand";
import { DEMAND_OWNER } from "@/lib/agent/detection-demand";

let fetchMock: ReturnType<typeof vi.fn>;
let visibility: DocumentVisibilityState = "visible";

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface Sent {
  url: string;
  key: string | undefined;
  body: { camera_id: string; hold_s: number; owner: string };
}

function sent(): Sent[] {
  return fetchMock.mock.calls.map(([url, init]) => ({
    url: url as string,
    key: ((init as RequestInit).headers as Record<string, string>)["X-ADOS-Key"],
    body: JSON.parse((init as RequestInit).body as string),
  }));
}

/** Run timers and let the chained lease requests settle. */
async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function setVisibility(next: DocumentVisibilityState): void {
  visibility = next;
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

describe("useDetectionDemand", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    agents.clear();
    agents.set("dev-1", { agentUrl: "http://drone.local:8080", apiKey: "k1" });
    demo.on = false;
    visibility = "visible";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibility,
    });
    fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { camera_id: string; hold_s: number };
      return reply({
        camera_id: body.camera_id,
        detecting: body.hold_s > 0,
        until_ms: body.hold_s > 0 ? 6000 : null,
      });
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("holds a lease on the shown camera, renews it every 2 s and releases it on unmount", async () => {
    const { result, unmount } = renderHook(() => useDetectionDemand("node:dev-1", "main", true));
    expect(result.current).toBe("pending");
    await advance(0);

    expect(sent()).toEqual([
      {
        url: "http://drone.local:8080/api/vision/demand",
        key: "k1",
        body: { camera_id: "main", hold_s: 6, owner: DEMAND_OWNER },
      },
    ]);
    expect(result.current).toBe("detecting");

    await advance(2000);
    await advance(2000);
    expect(sent().map((s) => s.body.hold_s)).toEqual([6, 6, 6]);

    unmount();
    await advance(0);
    expect(sent().at(-1)?.body).toEqual({ camera_id: "main", hold_s: 0, owner: DEMAND_OWNER });

    const count = fetchMock.mock.calls.length;
    await advance(6000);
    expect(fetchMock.mock.calls.length).toBe(count);
  });

  it("shares one lease between views on the same camera; the last to close releases it", async () => {
    const a = renderHook(() => useDetectionDemand("node:dev-1", "belly", true));
    const b = renderHook(() => useDetectionDemand("node:dev-1", "belly", true));
    await advance(0);
    await advance(2000);
    // One request per period, not one per view.
    expect(sent().map((s) => s.body.hold_s)).toEqual([6, 6]);
    expect(b.result.current).toBe("detecting");

    a.unmount();
    await advance(2000);
    expect(sent().map((s) => s.body.hold_s)).toEqual([6, 6, 6]);

    b.unmount();
    await advance(0);
    expect(sent().at(-1)?.body.hold_s).toBe(0);
  });

  it("moves the lease when the shown camera changes", async () => {
    const { rerender, unmount } = renderHook(
      ({ camera }) => useDetectionDemand("node:dev-1", camera, true),
      { initialProps: { camera: "main" } },
    );
    await advance(0);
    rerender({ camera: "belly" });
    await advance(0);

    expect(sent().map((s) => [s.body.camera_id, s.body.hold_s])).toEqual([
      ["main", 6],
      ["main", 0],
      ["belly", 6],
    ]);
    unmount();
    await advance(0);
  });

  it("releases while the page is hidden and takes the lease again when it shows", async () => {
    const { result, unmount } = renderHook(() => useDetectionDemand("node:dev-1", "main", true));
    await advance(0);

    setVisibility("hidden");
    await advance(0);
    expect(result.current).toBeNull();
    expect(sent().at(-1)?.body.hold_s).toBe(0);
    const count = fetchMock.mock.calls.length;
    await advance(4000);
    expect(fetchMock.mock.calls.length).toBe(count);

    setVisibility("visible");
    await advance(0);
    expect(sent().at(-1)?.body.hold_s).toBe(6);
    expect(result.current).toBe("detecting");
    unmount();
    await advance(0);
  });

  it("holds nothing when disabled, without a camera, or in demo mode", async () => {
    const off = renderHook(() => useDetectionDemand("node:dev-1", "main", false));
    const noCam = renderHook(() => useDetectionDemand("node:dev-1", null, true));
    demo.on = true;
    const inDemo = renderHook(() => useDetectionDemand("node:dev-1", "main", true));
    await advance(4000);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(off.result.current).toBeNull();
    expect(noCam.result.current).toBeNull();
    expect(inDemo.result.current).toBeNull();
  });

  it("reports no-link and sends nothing without a direct link to the drone", async () => {
    const { result, unmount } = renderHook(() => useDetectionDemand("node:dev-2", "main", true));
    await advance(2000);
    expect(result.current).toBe("no-link");
    unmount();
    await advance(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports an idle detector the agent accepted the lease for", async () => {
    fetchMock.mockImplementation(async () => reply({ camera_id: "main", detecting: false, until_ms: null }));
    const { result, unmount } = renderHook(() => useDetectionDemand("node:dev-1", "main", true));
    await advance(0);
    expect(result.current).toBe("idle");
    unmount();
    await advance(0);
  });

  it("reports a camera the agent refuses, and keeps asking", async () => {
    fetchMock.mockImplementation(async () => reply({ error: "camera not captured" }, 400));
    const { result, unmount } = renderHook(() => useDetectionDemand("node:dev-1", "rear", true));
    await advance(0);
    expect(result.current).toBe("rejected");
    await advance(2000);
    expect(fetchMock.mock.calls.length).toBe(2);
    unmount();
    await advance(0);
  });

  it.each([401, 403])("reports a refused pairing key (%i) apart from a refused camera", async (code) => {
    fetchMock.mockImplementation(async () => reply({ detail: "unauthorized" }, code));
    const { result, unmount } = renderHook(() => useDetectionDemand("node:dev-1", "main", true));
    await advance(0);
    expect(result.current).toBe("unauthorized");
    expect(result.current).not.toBe("rejected");
    unmount();
    await advance(0);
  });

  it("reports any other refusal as an error, not a refused camera", async () => {
    fetchMock.mockImplementation(async () => reply({ detail: "unprocessable" }, 422));
    const { result, unmount } = renderHook(() => useDetectionDemand("node:dev-1", "main", true));
    await advance(0);
    expect(result.current).toBe("error");
    unmount();
    await advance(0);
  });

  it("holds each window's lease under its own owner, so one window's release spares the other's", async () => {
    // Two fresh module loads stand in for two windows, each with its own
    // module state; a static import yields only the one shared instance.
    vi.resetModules();
    const windowA = await import("@/lib/agent/detection-demand");
    vi.resetModules();
    const windowB = await import("@/lib/agent/detection-demand");
    expect(windowA.DEMAND_OWNER).toMatch(/^mission-control:[0-9a-f]{16}$/);
    expect(windowB.DEMAND_OWNER).toMatch(/^mission-control:[0-9a-f]{16}$/);
    expect(windowA.DEMAND_OWNER).not.toBe(windowB.DEMAND_OWNER);

    const releaseA = windowA.holdDetectionDemand("node:dev-1", "main", () => {});
    const releaseB = windowB.holdDetectionDemand("node:dev-1", "main", () => {});
    await advance(0);
    expect(sent().map((s) => [s.body.owner, s.body.hold_s])).toEqual([
      [windowA.DEMAND_OWNER, 6],
      [windowB.DEMAND_OWNER, 6],
    ]);

    releaseA();
    await advance(2000);
    const releases = sent().filter((s) => s.body.hold_s === 0);
    expect(releases.map((s) => s.body.owner)).toEqual([windowA.DEMAND_OWNER]);
    // Window B keeps renewing its own lease.
    expect(sent().at(-1)?.body).toEqual({ camera_id: "main", hold_s: 6, owner: windowB.DEMAND_OWNER });

    releaseB();
    await advance(0);
    expect(sent().at(-1)?.body).toEqual({ camera_id: "main", hold_s: 0, owner: windowB.DEMAND_OWNER });
  });

  it("stops asking an agent without the demand endpoint", async () => {
    fetchMock.mockImplementation(async () => reply({ detail: "Not Found" }, 404));
    const { result, unmount } = renderHook(() => useDetectionDemand("node:dev-1", "main", true));
    await advance(0);
    expect(result.current).toBe("unsupported");
    await advance(6000);
    unmount();
    await advance(0);
    // One request; no renewals and no release.
    expect(fetchMock.mock.calls.length).toBe(1);
  });

  it("reports an unreachable agent and keeps renewing", async () => {
    fetchMock.mockImplementation(async () => {
      throw new TypeError("network down");
    });
    const { result, unmount } = renderHook(() => useDetectionDemand("node:dev-1", "main", true));
    await advance(0);
    expect(result.current).toBe("error");
    await advance(2000);
    expect(fetchMock.mock.calls.length).toBe(2);
    unmount();
    await advance(0);
  });
});
