/**
 * @module command/settings/WifiClientSection.identity-reset.test
 * @description The Wi-Fi Join form holds a write-only passphrase and an SSID.
 * The section renders the same field instances in place when the focused agent
 * changes, so without a reset a credential typed for node A could be submitted
 * to node B. This pins that the form clears when the agent identity changes,
 * that the page reads and writes only through a connection attached to the
 * node it is rendered for, and that a late answer from the previous node is
 * dropped.
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen, waitFor, act } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (k: string) => k,
}));

vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const net = vi.hoisted(() => ({
  statusCalls: [] as string[],
  leaveCalls: [] as string[],
  /** When set, a status read started now waits for it before answering. */
  hold: null as Promise<void> | null,
}));

vi.mock("@/lib/agent/network-client", () => ({
  AgentNetworkError: class extends Error {
    needsForce = false;
  },
  agentNetworkContext: (url: string | null, key: string | null) =>
    url && key ? { baseUrl: url, apiKey: key } : null,
  getWifiStatus: async (ctx: { baseUrl: string }) => {
    net.statusCalls.push(ctx.baseUrl);
    const hold = net.hold;
    if (hold) await hold;
    return {
      connected: true,
      ssid: `ssid-at-${ctx.baseUrl}`,
      signal: null,
      ip: null,
      security: null,
    };
  },
  getConfiguredWifi: async () => [],
  scanWifi: async () => [],
  joinWifi: async () => ({ joined: true }),
  leaveWifi: async (ctx: { baseUrl: string }) => {
    net.leaveCalls.push(ctx.baseUrl);
    return {};
  },
  forgetWifi: async () => {},
  setWifiAutoconnect: async () => {},
  isRouteUnexposed: () => false,
}));

const store = vi.hoisted(() => ({
  state: {
    agentUrl: "http://node-a.example:8080",
    apiKey: "key-A",
    nodeDeviceId: "A",
  } as { agentUrl: string | null; apiKey: string | null; nodeDeviceId: string | null },
}));

vi.mock("@/stores/agent-connection-store", () => ({
  useAgentConnectionStore: (sel: (s: typeof store.state) => unknown) =>
    sel(store.state),
}));

import { WifiClientSection } from "../WifiClientSection";

beforeEach(() => {
  net.statusCalls = [];
  net.leaveCalls = [];
  net.hold = null;
  store.state = {
    agentUrl: "http://node-a.example:8080",
    apiKey: "key-A",
    nodeDeviceId: "A",
  };
});

describe("WifiClientSection — credentials do not leak across an agent switch", () => {
  it("clears the SSID and passphrase when the agent identity changes", async () => {
    const { rerender } = render(<WifiClientSection nodeDeviceId="A" />);
    const ssid = () =>
      document.getElementById("wifi-join-ssid") as HTMLInputElement;
    const pass = () =>
      document.getElementById("wifi-join-passphrase") as HTMLInputElement;

    // Operator types a credential for node A.
    fireEvent.change(ssid(), { target: { value: "field-net" } });
    fireEvent.change(pass(), { target: { value: "s3cr3t-for-A" } });
    expect(ssid().value).toBe("field-net");
    expect(pass().value).toBe("s3cr3t-for-A");

    // Switch the focused agent to node B (different url / key / device id).
    store.state = {
      agentUrl: "http://node-b.example:8080",
      apiKey: "key-B",
      nodeDeviceId: "B",
    };
    rerender(<WifiClientSection nodeDeviceId="B" />);

    // Both fields clear so the credential cannot be submitted to node B.
    await waitFor(() => {
      expect(ssid().value).toBe("");
      expect(pass().value).toBe("");
    });
  });
});

describe("WifiClientSection — acts only on the node it is rendered for", () => {
  it("never reads or leaves through a connection attached to another node", async () => {
    // The focused connection is still node A while the page renders node B.
    render(<WifiClientSection nodeDeviceId="B" />);
    await waitFor(() =>
      expect(screen.getByText("network.liveRequiresLan")).toBeTruthy(),
    );
    expect(screen.queryByText("wifi.leaveAction")).toBeNull();
    expect(net.statusCalls).toEqual([]);
    expect(net.leaveCalls).toEqual([]);
  });

  it("reads through the connection when it is attached to this node", async () => {
    render(<WifiClientSection nodeDeviceId="A" />);
    await waitFor(() =>
      expect(
        screen.getByText("ssid-at-http://node-a.example:8080"),
      ).toBeTruthy(),
    );
    expect(net.statusCalls[0]).toBe("http://node-a.example:8080");
  });

  it("drops a status answer from the previous node after a switch", async () => {
    const gate: { release?: () => void } = {};
    net.hold = new Promise<void>((resolve) => {
      gate.release = resolve;
    });
    const { rerender } = render(<WifiClientSection nodeDeviceId="A" />);
    await waitFor(() => expect(net.statusCalls.length).toBe(1));

    // Node A's read is still in flight when the page moves to node B.
    net.hold = null;
    store.state = {
      agentUrl: "http://node-b.example:8080",
      apiKey: "key-B",
      nodeDeviceId: "B",
    };
    rerender(<WifiClientSection nodeDeviceId="B" />);
    await waitFor(() =>
      expect(
        screen.getByText("ssid-at-http://node-b.example:8080"),
      ).toBeTruthy(),
    );

    await act(async () => {
      gate.release!();
    });
    expect(screen.getByText("ssid-at-http://node-b.example:8080")).toBeTruthy();
    expect(
      screen.queryByText("ssid-at-http://node-a.example:8080"),
    ).toBeNull();
  });
});
