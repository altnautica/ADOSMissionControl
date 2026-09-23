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
import { cleanup, render, waitFor } from "@testing-library/react";

vi.mock("@/lib/agent/resolve-agent", () => ({
  resolveLocalAgentForDrone: (droneId: string) =>
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
