/**
 * @license GPL-3.0-only
 *
 * What the plugin iframe host feeds a node-bound plugin on its own: the
 * plugin's agent-published state, read from the same source the native HUD
 * reads (the node's heartbeat slice when signed in), each report once with
 * the agent's report time; and the node's camera display names.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, renderHook } from "@testing-library/react";

// Persisted local-nodes-store: bind an in-memory localStorage before import.
vi.hoisted(() => {
  const mem = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, String(v)),
      removeItem: (k: string) => void mem.delete(k),
      clear: () => mem.clear(),
      key: (i: number) => [...mem.keys()][i] ?? null,
      get length() {
        return mem.size;
      },
    },
  });
});

import { useFollowStateEntry } from "@/hooks/use-nav-feed";
import { AGENT_STATE_POLL_MS } from "@/lib/plugins/agent-state-feed";
import { PLUGIN_CAMERAS_EVENT } from "@/lib/plugins/use-plugin-camera-names";
import { useAuthStore } from "@/stores/auth-store";
import { useLocalNodesStore } from "@/stores/local-nodes-store";
import { usePluginCloudStateStore } from "@/stores/plugin-cloud-state-store";

import { PluginIframeHost } from "../PluginIframeHost";

const FOLLOW_ME = "com.altnautica.follow-me";
const DEVICE = "dev-7";
const BUNDLE = "data:text/html;charset=utf-8,%3Cp%3Eplugin%3C%2Fp%3E";

const postMessage = vi.fn();
const fetchMock = vi.fn<typeof fetch>();

function mountHost(agentId: string) {
  return render(
    <PluginIframeHost
      pluginId={FOLLOW_ME}
      slot="hardware.tab"
      bundleUrl={BUNDLE}
      grantedCapabilities={new Set<string>()}
      handlers={{}}
      agentId={agentId}
    />,
  );
}

/** Every event posted into the frame under `method`, as its args. */
function posted(method: string): unknown[] {
  return postMessage.mock.calls
    .map(([env]) => env as { method?: string; args?: unknown })
    .filter((env) => env.method === method)
    .map((env) => env.args);
}

function setFollowSlice(tsMs: number, payload: Record<string, unknown>) {
  usePluginCloudStateStore
    .getState()
    .setForDevice(DEVICE, { [FOLLOW_ME]: { "follow.state": { payload, ts_ms: tsMs } } }, Date.now());
}

beforeEach(() => {
  postMessage.mockReset();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => new Response("{}", { status: 404 }));
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(HTMLIFrameElement.prototype, "contentWindow", "get").mockReturnValue({
    postMessage,
  } as unknown as Window);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useAuthStore.setState({ isAuthenticated: false });
  usePluginCloudStateStore.setState({ byDevice: {}, updatedAt: {} });
  useLocalNodesStore.setState({ nodes: [] });
});

describe("agent state for a cloud-reached node", () => {
  it("forwards the HUD's follow report with its own report time, once per report", async () => {
    vi.useFakeTimers();
    useAuthStore.setState({ isAuthenticated: true });
    const reportAt = Date.now() - 1500;
    setFollowSlice(reportAt, { active: true, phase: "following" });

    const view = mountHost(`node:${DEVICE}`);
    // Each frame document load replays the latest report (same time); count
    // them so the check is about the feed, not the test DOM's load timing.
    let loads = 0;
    view.container.querySelector("iframe")!.addEventListener("load", () => {
      loads += 1;
    });
    await vi.advanceTimersByTimeAsync(0);

    // The native HUD reads the same report, stamped with the same time.
    const hud = renderHook(() => useFollowStateEntry(DEVICE));
    expect(hud.result.current?.receivedAt).toBe(reportAt);
    const first = { active: true, phase: "following", ts_ms: reportAt };
    expect(posted("follow.state")).toEqual(Array(1 + loads).fill(first));

    // The slice still holds that report: it is not sent again as if new.
    await vi.advanceTimersByTimeAsync(AGENT_STATE_POLL_MS * 4);
    expect(posted("follow.state")).toEqual(Array(1 + loads).fill(first));

    const loadsBefore = loads;
    const nextAt = reportAt + 1000;
    const next = { active: true, phase: "holding", ts_ms: nextAt };
    setFollowSlice(nextAt, { active: true, phase: "holding" });
    await vi.advanceTimersByTimeAsync(AGENT_STATE_POLL_MS * 5);
    expect(loads).toBe(loadsBefore);
    expect(posted("follow.state")).toEqual([...Array(1 + loads).fill(first), next]);

    // Unmounting lets the feed go: a later report reaches nothing.
    view.unmount();
    setFollowSlice(nextAt + 1000, { active: false, phase: "idle" });
    await vi.advanceTimersByTimeAsync(AGENT_STATE_POLL_MS * 2);
    expect(posted("follow.state")).toEqual([...Array(1 + loads).fill(first), next]);
    hud.unmount();
  });

  it("replays the latest report when the frame document loads", async () => {
    vi.useFakeTimers();
    useAuthStore.setState({ isAuthenticated: true });
    const reportAt = Date.now() - 500;
    setFollowSlice(reportAt, { active: false, phase: "idle" });

    const view = mountHost(DEVICE);
    await vi.advanceTimersByTimeAsync(0);
    const before = posted("follow.state").length;
    expect(before).toBeGreaterThanOrEqual(1);
    view.container.querySelector("iframe")!.dispatchEvent(new Event("load"));

    // The same report, with the same time: the frame ages it, not the host.
    const after = posted("follow.state");
    expect(after).toHaveLength(before + 1);
    expect(after.at(-1)).toEqual({ active: false, phase: "idle", ts_ms: reportAt });
    view.unmount();
  });
});

describe("camera names", () => {
  it("passes the node's camera display names to the plugin", async () => {
    useLocalNodesStore.setState({
      nodes: [
        {
          deviceId: DEVICE,
          name: "bench",
          hostname: "http://192.168.1.30:8080",
          apiKey: "key-dev",
          profile: "drone",
          pairedAt: 0,
        },
      ],
    });
    fetchMock.mockImplementation(async (input) =>
      String(input).endsWith("/api/video/roster")
        ? new Response(
            JSON.stringify({
              cameras: [
                { id: "cam-front-0", name: "Nose camera", source: "/dev/video0", state: "assigned" },
                { id: "cam-down-0", source: "/dev/video2", state: "assigned" },
              ],
            }),
            { status: 200 },
          )
        : new Response("{}", { status: 404 }),
    );

    const view = mountHost(DEVICE);
    await vi.waitFor(() =>
      expect(posted(PLUGIN_CAMERAS_EVENT)).toContainEqual({
        cameras: [
          { id: "cam-front-0", name: "Nose camera" },
          { id: "cam-down-0", name: null },
        ],
      }),
    );
    view.unmount();
  });

  it("sends no camera list when the node's roster cannot be read", async () => {
    const view = mountHost(DEVICE);
    await new Promise((r) => setTimeout(r, 20));
    expect(posted(PLUGIN_CAMERAS_EVENT)).toEqual([]);
    view.unmount();
  });
});
