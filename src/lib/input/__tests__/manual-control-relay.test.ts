/**
 * @license GPL-3.0-only
 *
 * A cloud-relayed link publishes stick frames through the broker, which
 * silently discards a publish made without a write grant. The stream must not
 * transmit into that, and must say why.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { useInputStore } from "@/stores/input-store";
import { useMqttControlGrantStore } from "@/stores/mqtt-control-grant-store";

const protocol = {
  isConnected: true,
  sendManualControl: vi.fn(),
  getCapabilities: () => ({ manualControlHz: 50 }),
};
let transport: { type: string; canCommand: boolean } = { type: "mqtt-mavlink", canCommand: false };

vi.mock("@/stores/drone-manager", () => ({
  useDroneManager: {
    getState: () => ({
      getSelectedProtocol: () => protocol,
      selectedDroneId: "node:drone-1",
      drones: new Map([["node:drone-1", { transport }]]),
    }),
  },
}));

vi.mock("@/stores/drone-store", () => ({
  useDroneStore: { getState: () => ({ armState: "armed", flightMode: "STABILIZE" }) },
}));

const { manualControlTick, stopManualControlStream } = await import("../gamepad-poller");

describe("manual control over a cloud relay", () => {
  beforeEach(() => {
    protocol.sendManualControl.mockClear();
    const s = useInputStore.getState();
    s.setController("gamepad");
    s.setManualControlEnabled(true);
    s.setAxes([0, 0, 0, 0]);
  });

  afterEach(() => {
    stopManualControlStream();
    useInputStore.getState().resetInput();
    useMqttControlGrantStore.setState({ grant: null, minting: false });
  });

  it("sends nothing and names the reason when no write grant is held", () => {
    transport = { type: "mqtt-mavlink", canCommand: false };

    manualControlTick();

    expect(protocol.sendManualControl).not.toHaveBeenCalled();
    expect(useInputStore.getState().manualControlLinkBlock).toMatch(/write grant/);
  });

  it("transmits once the relay carries a live grant for the drone", () => {
    transport = { type: "mqtt-mavlink", canCommand: true };
    useMqttControlGrantStore.setState({
      grant: {
        deviceIds: ["drone-1"],
        expiresAt: Date.now() + 60 * 60 * 1000,
        writeConfirmed: true,
      },
    });

    manualControlTick();

    expect(protocol.sendManualControl).toHaveBeenCalledTimes(1);
    expect(useInputStore.getState().manualControlLinkBlock).toBeNull();
  });

  it("does not apply the broker rule to a direct link", () => {
    transport = { type: "websocket", canCommand: true };

    manualControlTick();

    expect(protocol.sendManualControl).toHaveBeenCalledTimes(1);
  });
});
