/**
 * @license GPL-3.0-only
 *
 * A trusted inline module gets what an iframe plugin gets from the host: its
 * own agent-published state for a cloud-reached node, from the node's
 * heartbeat slice, each report once with the agent's report time; and the
 * node's camera display names.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

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

import messages from "../../../../locales/en.json";
import { AGENT_STATE_POLL_MS } from "@/lib/plugins/agent-state-feed";
import type { InlineBundle } from "@/lib/plugins/inline-loader";
import { PLUGIN_CAMERAS_EVENT } from "@/lib/plugins/use-plugin-camera-names";
import { useAuthStore } from "@/stores/auth-store";
import { useLocalNodesStore } from "@/stores/local-nodes-store";
import { usePluginCloudStateStore } from "@/stores/plugin-cloud-state-store";

import { InlinePluginHost } from "../InlinePluginHost";

const FOLLOW_ME = "com.altnautica.follow-me";
const DEVICE = "dev-9";

const fetchMock = vi.fn<typeof fetch>();
const received: Record<string, unknown[]> = {};

function bundle(): InlineBundle {
  return {
    kind: "inline",
    trust: { pluginId: FOLLOW_ME, version: "1.0.0", signerId: "s", entrypoint: "gcs/m.js", paths: [] },
    readAsset: async () => new Blob([]),
    module: {
      mount(_root, host) {
        const offs = ["follow.state", PLUGIN_CAMERAS_EVENT].map((topic) =>
          host.ctx.events.subscribe(topic, (args: unknown) => {
            (received[topic] ??= []).push(args);
          }),
        );
        return () => offs.forEach((off) => off());
      },
    },
  };
}

function mountHost() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <InlinePluginHost
        pluginId={FOLLOW_ME}
        panelId="follow"
        slot="hardware.tab"
        bundle={bundle()}
        grantedCapabilities={new Set<string>()}
        handlers={{}}
        agentId={DEVICE}
      />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  for (const k of Object.keys(received)) delete received[k];
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => new Response("{}", { status: 404 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  useAuthStore.setState({ isAuthenticated: false });
  usePluginCloudStateStore.setState({ byDevice: {}, updatedAt: {} });
  useLocalNodesStore.setState({ nodes: [] });
});

describe("inline module feeds", () => {
  it("delivers the node's follow report once, with its report time", async () => {
    useAuthStore.setState({ isAuthenticated: true });
    const reportAt = Date.now() - 1200;
    usePluginCloudStateStore.getState().setForDevice(
      DEVICE,
      { [FOLLOW_ME]: { "follow.state": { payload: { phase: "following" }, ts_ms: reportAt } } },
      Date.now(),
    );
    const view = mountHost();
    await vi.waitFor(() =>
      expect(received["follow.state"]).toEqual([{ phase: "following", ts_ms: reportAt }]),
    );
    // Two more polls of the same slice deliver nothing new.
    await new Promise((r) => setTimeout(r, AGENT_STATE_POLL_MS * 2 + 100));
    expect(received["follow.state"]).toHaveLength(1);
    view.unmount();
  });

  it("passes the node's camera display names", async () => {
    useLocalNodesStore.setState({
      nodes: [
        {
          deviceId: DEVICE,
          name: "bench",
          hostname: "http://192.168.1.31:8080",
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
              cameras: [{ id: "cam-front-0", name: "Nose camera", source: "/dev/video0" }],
            }),
            { status: 200 },
          )
        : new Response("{}", { status: 404 }),
    );
    const view = mountHost();
    await vi.waitFor(() =>
      expect(received[PLUGIN_CAMERAS_EVENT]).toEqual([
        { cameras: [{ id: "cam-front-0", name: "Nose camera" }] },
      ]),
    );
    view.unmount();
  });
});
