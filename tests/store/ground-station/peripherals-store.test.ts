/**
 * Smoke tests for the peripherals slice of the ground-station store.
 * Asserts the initial-state defaults for pic, gamepads, bluetooth,
 * display, and the peripheral-manager listing, plus a resetAll
 * pathway. Async peripheral actions that require an api client are
 * out of scope here.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach } from "vitest";

import { useGroundStationStore } from "@/stores/ground-station-store";

describe("ground-station peripherals slice", () => {
  beforeEach(() => {
    useGroundStationStore.getState().resetAll();
  });

  it("has correct initial state", () => {
    const s = useGroundStationStore.getState();
    expect(s.display).toBeNull();
    expect(s.pic).toEqual({
      state: "idle",
      claimed_by: null,
      claim_counter: 0,
      primary_gamepad_id: null,
      loading: false,
      error: null,
    });
    expect(s.gamepads).toEqual({
      devices: [],
      primary_id: null,
      loading: false,
    });
    expect(s.bluetooth).toEqual({
      scanning: false,
      scan_results: [],
      paired: [],
      pairedFor: null,
      pairing_mac: null,
      error: null,
    });
    expect(s.peripherals).toEqual({
      list: [],
      detail: {},
      loading: false,
      error: null,
    });
  });

  it("resetAll clears mutated peripherals fields", () => {
    useGroundStationStore.setState({
      pic: {
        state: "claimed",
        claimed_by: "client-a",
        claim_counter: 4,
        primary_gamepad_id: "gp-1",
        loading: false,
        error: null,
      },
      bluetooth: {
        scanning: true,
        scan_results: [],
        paired: [],
        pairedFor: null,
        pairing_mac: "AA:BB:CC:DD:EE:FF",
        error: null,
      },
    });
    useGroundStationStore.getState().resetAll();
    const s = useGroundStationStore.getState();
    expect(s.pic.state).toBe("idle");
    expect(s.pic.claimed_by).toBeNull();
    expect(s.bluetooth.scanning).toBe(false);
    expect(s.bluetooth.pairing_mac).toBeNull();
  });

  it("gamepads slice defaults to no devices and no primary", () => {
    const g = useGroundStationStore.getState().gamepads;
    expect(g.devices).toEqual([]);
    expect(g.primary_id).toBeNull();
    expect(g.loading).toBe(false);
  });
});
