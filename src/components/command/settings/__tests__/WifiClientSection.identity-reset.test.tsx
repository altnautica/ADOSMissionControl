/**
 * @module command/settings/WifiClientSection.identity-reset.test
 * @description The Wi-Fi Join form holds a write-only passphrase and an SSID.
 * The section renders the same field instances in place when the focused agent
 * changes, so without a reset a credential typed for node A could be submitted
 * to node B. This pins that the form clears when the agent identity changes.
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (k: string) => k,
}));

vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/lib/agent/network-client", () => ({
  AgentNetworkError: class extends Error {
    needsForce = false;
  },
  agentNetworkContext: (url: string | null, key: string | null) =>
    url && key ? { baseUrl: url, apiKey: key } : null,
  getWifiStatus: async () => ({
    connected: false,
    ssid: null,
    signal: null,
    ip: null,
    security: null,
  }),
  getConfiguredWifi: async () => [],
  scanWifi: async () => [],
  joinWifi: async () => ({ joined: true }),
  leaveWifi: async () => ({}),
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
  store.state = {
    agentUrl: "http://node-a.example:8080",
    apiKey: "key-A",
    nodeDeviceId: "A",
  };
});

describe("WifiClientSection — credentials do not leak across an agent switch", () => {
  it("clears the SSID and passphrase when the agent identity changes", async () => {
    const { rerender } = render(<WifiClientSection />);
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
    rerender(<WifiClientSection />);

    // Both fields clear so the credential cannot be submitted to node B.
    await waitFor(() => {
      expect(ssid().value).toBe("");
      expect(pass().value).toBe("");
    });
  });
});
