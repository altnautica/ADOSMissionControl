/**
 * Smoke tests for the link slice of the ground-station store. Asserts the
 * initial-state defaults, a couple of synchronous setters, and the reset
 * pathway. The slice is exercised through the aggregator hook because
 * slice creators only have meaning when combined into the full store.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach } from "vitest";

import { useGroundStationStore } from "@/stores/ground-station-store";

describe("ground-station link slice", () => {
  beforeEach(() => {
    useGroundStationStore.getState().reset();
  });

  it("has correct initial state", () => {
    const s = useGroundStationStore.getState();
    expect(s.wfbConfig).toBeNull();
    expect(s.loading).toBe(false);
    expect(s.lastError).toBeNull();
    expect(s.lastFetchedAt).toBeNull();
    expect(s.linkHealth).toEqual({
      rssi_dbm: null,
      bitrate_mbps: null,
      fec_rec: 0,
      fec_lost: 0,
      channel: null,
    });
    expect(s.status).toEqual({
      pair_rearm: null,
      paired_drone: null,
      profile: "unconfigured",
      uplink_active: null,
    });
  });

  it("setLoading toggles the loading flag", () => {
    useGroundStationStore.getState().setLoading(true);
    expect(useGroundStationStore.getState().loading).toBe(true);
    useGroundStationStore.getState().setLoading(false);
    expect(useGroundStationStore.getState().loading).toBe(false);
  });

  it("setError records and clears the last error message", () => {
    useGroundStationStore.getState().setError("radio offline");
    expect(useGroundStationStore.getState().lastError).toBe("radio offline");
    useGroundStationStore.getState().setError(null);
    expect(useGroundStationStore.getState().lastError).toBeNull();
  });

  it("reset returns link slice fields to their defaults", () => {
    useGroundStationStore.getState().setLoading(true);
    useGroundStationStore.getState().setError("boom");
    useGroundStationStore.getState().reset();
    const s = useGroundStationStore.getState();
    expect(s.loading).toBe(false);
    expect(s.lastError).toBeNull();
    expect(s.wfbConfig).toBeNull();
  });
});
