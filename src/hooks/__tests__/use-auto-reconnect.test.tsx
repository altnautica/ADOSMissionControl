/**
 * @license GPL-3.0-only
 *
 * Auto-connect on load is best-effort, but a failure must not keep the link it
 * opened: a port held by a dead attempt refuses the operator's manual Connect.
 */

import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const { disconnect } = vi.hoisted(() => ({ disconnect: vi.fn(async () => {}) }));

vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/recent-connections", () => ({
  getRecentConnections: async () => [
    { type: "websocket", url: "ws://192.168.1.50:5760", firmwareType: "ardupilot-copter" },
  ],
}));
vi.mock("@/lib/agent/paired-agent-match", () => ({ pairedAgentDeviceIdForUrl: () => null }));
vi.mock("@/lib/protocol/transport/websocket", () => ({
  WebSocketTransport: class {
    connect = async () => {};
    disconnect = disconnect;
  },
}));
vi.mock("@/lib/protocol/select-fc-adapter", () => ({
  createFcAdapter: async () => ({
    connect: async () => {
      throw new Error("no heartbeat");
    },
  }),
}));

import { useSettingsStore } from "@/stores/settings-store";
import { useAutoReconnect } from "../use-auto-reconnect";

describe("useAutoReconnect load-time connect", () => {
  it("closes the transport it opened when the FC handshake fails", async () => {
    useSettingsStore.setState({ _hasHydrated: true, autoConnectOnLoad: true });

    renderHook(() => useAutoReconnect());

    await waitFor(() => expect(disconnect).toHaveBeenCalledTimes(1));
  });
});
