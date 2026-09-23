/**
 * What the plugin host delivers into a plugin's iframe, in the message shape
 * the plugin SDK dispatches on (`{type: "event", method}`; `client.on(method)`):
 *   - the plugin's current settings on mount, read back from the drone's agent
 *     (GET /api/plugins/{id}/config, ados-control plugins_config.rs) as
 *     `config.changed`, which ctx.config.onChange listens for;
 *   - the plugin's own agent state republished by the state egress, with the
 *     topic as the method, which ctx.events.subscribe(topic) listens for.
 *
 * @license GPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";

vi.mock("@/lib/agent/resolve-agent", () => ({
  resolveLanAgent: (droneId: string) =>
    droneId === "drone-1" ? { agentUrl: "http://192.168.1.50:8080", apiKey: "k1" } : null,
}));

import { PluginIframeHost } from "@/components/plugins/PluginIframeHost";
import { agentStateOrigin, publishPluginEvent } from "@/lib/plugins/event-bus";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("plugin config on mount", () => {
  it("delivers the config the drone already holds as config.changed", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(
        JSON.stringify({ plugin_id: "com.example.follow", values: { follow_distance_m: 25, active: true } }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const posted: unknown[] = [];
    const fakeWindow = { postMessage: (data: unknown) => posted.push(data) } as unknown as Window;
    const proto = HTMLIFrameElement.prototype;
    const original = Object.getOwnPropertyDescriptor(proto, "contentWindow");
    Object.defineProperty(proto, "contentWindow", { configurable: true, get: () => fakeWindow });
    try {
      render(
        <PluginIframeHost
          pluginId="com.example.follow"
          slot="drone.detail.tab"
          bundleUrl="blob:follow"
          grantedCapabilities={new Set(["ui.slot.drone-detail-tab"])}
          handlers={{}}
          agentId="drone-1"
        />,
      );

      await waitFor(() =>
        expect(posted).toContainEqual(
          expect.objectContaining({
            type: "event",
            method: "config.changed",
            args: { follow_distance_m: 25, active: true },
          }),
        ),
      );
      expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
        "http://192.168.1.50:8080/api/plugins/com.example.follow/config",
      );
    } finally {
      if (original) Object.defineProperty(proto, "contentWindow", original);
    }
  });
});

describe("plugin agent state", () => {
  it("delivers the plugin's own drone state under its topic, and nobody else's", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
    const posted: Array<{ method?: string; args?: unknown }> = [];
    const fakeWindow = {
      postMessage: (data: { method?: string; args?: unknown }) => posted.push(data),
    } as unknown as Window;
    const proto = HTMLIFrameElement.prototype;
    const original = Object.getOwnPropertyDescriptor(proto, "contentWindow");
    Object.defineProperty(proto, "contentWindow", { configurable: true, get: () => fakeWindow });
    try {
      render(
        <PluginIframeHost
          pluginId="com.example.pod"
          slot="drone.detail.tab"
          bundleUrl="blob:pod"
          grantedCapabilities={new Set(["ui.slot.drone-detail-tab"])}
          handlers={{}}
          agentId="drone-1"
        />,
      );
      publishPluginEvent("example.pod.state", { zoom: 3 }, agentStateOrigin("com.example.pod", "drone-1"));
      publishPluginEvent("example.pod.state", { zoom: 9 }, agentStateOrigin("com.example.other", "drone-1"));
      publishPluginEvent("example.pod.state", { zoom: 7 }, agentStateOrigin("com.example.pod", "drone-2"));

      const state = posted.filter((m) => m.method === "example.pod.state");
      expect(state.map((m) => m.args)).toEqual([{ zoom: 3 }]);
    } finally {
      if (original) Object.defineProperty(proto, "contentWindow", original);
    }
  });
});

describe("plugin theme", () => {
  it("delivers the host's theme tokens as theme.changed and re-sends on a theme switch", async () => {
    // happy-dom holds each MutationObserver's listener through a WeakRef, so a
    // garbage collection mid-test silently detaches it and the re-send never
    // fires. A browser keeps it alive. The observer is replaced with one that
    // delivers root mutations on demand, so the test exercises the host's
    // re-read and re-send rather than the collector's timing.
    const rootObservers: Array<{ callback: MutationCallback; live: boolean }> = [];
    class ManualMutationObserver {
      #entry: { callback: MutationCallback; live: boolean };
      constructor(callback: MutationCallback) {
        this.#entry = { callback, live: false };
      }
      observe(target: Node) {
        if (target !== document.documentElement) return;
        this.#entry.live = true;
        rootObservers.push(this.#entry);
      }
      disconnect() {
        this.#entry.live = false;
      }
      takeRecords(): MutationRecord[] {
        return [];
      }
    }
    vi.stubGlobal("MutationObserver", ManualMutationObserver);

    const root = document.documentElement;
    root.style.setProperty("--alt-bg-primary", "#0a0a0a");
    const posted: Array<{ method?: string; args?: Record<string, string> }> = [];
    const fakeWindow = {
      postMessage: (data: { method?: string; args?: Record<string, string> }) => posted.push(data),
    } as unknown as Window;
    const proto = HTMLIFrameElement.prototype;
    const original = Object.getOwnPropertyDescriptor(proto, "contentWindow");
    Object.defineProperty(proto, "contentWindow", { configurable: true, get: () => fakeWindow });
    try {
      render(
        <PluginIframeHost
          pluginId="com.example.theme"
          slot="drone.detail.tab"
          bundleUrl="blob:theme"
          grantedCapabilities={new Set()}
          handlers={{}}
        />,
      );
      const themes = () => posted.filter((m) => m.method === "theme.changed");
      await waitFor(() =>
        expect(themes().at(-1)?.args?.["--bg-primary"]).toBe("#0a0a0a"),
      );

      root.style.setProperty("--alt-bg-primary", "#fdf6e3");
      const live = rootObservers.filter((o) => o.live);
      expect(live).toHaveLength(1);
      act(() => live[0].callback([], {} as MutationObserver));
      await waitFor(() =>
        expect(themes().at(-1)?.args?.["--bg-primary"]).toBe("#fdf6e3"),
      );
    } finally {
      if (original) Object.defineProperty(proto, "contentWindow", original);
      root.style.removeProperty("--alt-bg-primary");
    }
  });
});
