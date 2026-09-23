/**
 * Smoke tests for the mesh slice of the ground-station store. Asserts
 * the initial-state defaults for role, distributedRx, and mesh fields
 * plus a resetAll pathway. Async mesh actions that require an api
 * client (loadRole, applyRole, openPairingWindow, etc.) are out of
 * scope here.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach } from "vitest";

import { useGroundStationStore } from "@/stores/ground-station-store";

describe("ground-station mesh slice", () => {
  beforeEach(() => {
    useGroundStationStore.getState().resetAll();
  });

  it("has correct initial state", () => {
    const s = useGroundStationStore.getState();
    expect(s.role).toEqual({
      info: null,
      loading: false,
      switching: false,
      error: null,
      fetchedAt: null,
    });
    expect(s.distributedRx).toEqual({
      receiverRelays: [],
      combined: null,
      relayStatus: null,
      pairingWindowOpen: false,
      pairingWindowExpiresAt: null,
      pairingCode: null,
      pendingRequests: [],
      loading: false,
      error: null,
    });
    expect(s.mesh).toEqual({
      health: null,
      neighbors: [],
      routes: [],
      gateways: [],
      selectedGateway: null,
      lastTransientEvent: null,
      wsState: "idle",
      wsDisconnectedAt: null,
      loading: false,
      error: null,
      fetchedAt: null,
    });
  });

  it("resetAll restores mesh slice fields after manual mutation", () => {
    useGroundStationStore.setState({
      role: { info: null, loading: true, switching: false, error: "boom", fetchedAt: null },
      mesh: {
        health: null,
        neighbors: [],
        routes: [],
        gateways: [],
        selectedGateway: null,
        lastTransientEvent: null,
        wsState: "connected",
        wsDisconnectedAt: 1700000000,
        loading: false,
        error: null,
        fetchedAt: null,
      },
    });
    useGroundStationStore.getState().resetAll();
    const s = useGroundStationStore.getState();
    expect(s.role.loading).toBe(false);
    expect(s.role.error).toBeNull();
    expect(s.mesh.wsState).toBe("idle");
    expect(s.mesh.wsDisconnectedAt).toBeNull();
  });

  it("pairing window flag defaults to closed", () => {
    expect(
      useGroundStationStore.getState().distributedRx.pairingWindowOpen,
    ).toBe(false);
    expect(
      useGroundStationStore.getState().distributedRx.pairingWindowExpiresAt,
    ).toBeNull();
  });
});
