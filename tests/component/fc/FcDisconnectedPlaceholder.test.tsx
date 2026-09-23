/**
 * The FC empty state is connection-aware: a locally-paired card that cannot
 * connect must never offer the misleading USB "connect a flight controller"
 * prompt. A stale (re-flashed / unpaired) card offers re-pair + remove; an
 * offline agent link routes to reconnect; only an actually-connected agent that
 * reports no autopilot keeps the original connect prompt.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "../../helpers/intl-wrapper";

interface MockState {
  stalePairing: unknown;
  connected: boolean;
  cloudMode: boolean;
  mavlinkPairRequired: boolean;
}

let mockState: MockState;

vi.mock("@/stores/agent-connection-store", () => ({
  useAgentConnectionStore: (sel: (s: MockState) => unknown) => sel(mockState),
}));

import { FcDisconnectedPlaceholder } from "@/components/fc/shared/FcDisconnectedPlaceholder";

beforeEach(() => {
  mockState = {
    stalePairing: null,
    connected: false,
    cloudMode: false,
    mavlinkPairRequired: false,
  };
});

describe("FcDisconnectedPlaceholder", () => {
  it("stale pairing → re-pair + remove, no USB connect prompt", () => {
    mockState.stalePairing = {
      reason: "reidentified",
      host: "http://192.168.0.5:8080",
      deviceId: "00025ad5",
      liveDeviceId: "21b0db85",
    };
    renderWithIntl(<FcDisconnectedPlaceholder droneName="Rig" />);
    expect(screen.getByText(/needs re-pairing/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /re-pair node/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /remove node/i })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /connect flight controller/i }),
    ).toBeNull();
  });

  it("offline LAN node (not connected) → offline state, no USB connect prompt", () => {
    mockState.connected = false;
    mockState.cloudMode = false;
    renderWithIntl(<FcDisconnectedPlaceholder droneName="Rig" />);
    expect(screen.getByText(/agent offline/i)).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /connect flight controller/i }),
    ).toBeNull();
  });

  it("agent connected but no autopilot → keeps the connect-FC prompt", () => {
    mockState.connected = true;
    renderWithIntl(<FcDisconnectedPlaceholder droneName="Rig" />);
    expect(
      screen.getByRole("button", { name: /connect flight controller/i }),
    ).toBeTruthy();
  });

  it("reachable but unpaired agent → pair this node, not a link failure", () => {
    mockState.connected = true;
    mockState.mavlinkPairRequired = true;
    renderWithIntl(<FcDisconnectedPlaceholder droneName="Rig" />);
    expect(screen.getByText(/pair this node to open its flight link/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /^pair this node$/i })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /connect flight controller/i }),
    ).toBeNull();
  });
});
