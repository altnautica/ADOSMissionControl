/**
 * Smoke tests for the uplink slice of the ground-station store. Asserts
 * the initial-state defaults for wifiScan, modem, uplink, and ethernet
 * config and verifies a couple of resetAll pathways. Also covers the
 * share-uplink toggle mapping the agent's apply result onto the slice.
 * Async uplink flows that require an api client (scan, join, leave) are
 * out of scope.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach } from "vitest";

import { useGroundStationStore } from "@/stores/ground-station-store";
import type { GroundStationApi } from "@/lib/api/ground-station-api";
import type { ShareUplinkResult } from "@/lib/api/ground-station/types/network";
import type { UplinkSlice } from "@/stores/ground-station/types";

const EMPTY_UPLINK: UplinkSlice = {
  active: null,
  priority: [],
  health: null,
  failover_log: [],
  data_cap: null,
  cloud_relay: null,
  shareUplinkApplied: null,
  shareUplinkAppliedReason: null,
  loading: false,
  error: null,
  fetchedAt: null,
};

/** Minimal api fake: toggleShareUplink only calls setShareUplink. */
function makeApi(result: ShareUplinkResult): GroundStationApi {
  return {
    setShareUplink: async (_enabled: boolean) => result,
  } as unknown as GroundStationApi;
}

describe("ground-station uplink slice", () => {
  beforeEach(() => {
    useGroundStationStore.getState().resetAll();
  });

  it("has correct initial state", () => {
    const s = useGroundStationStore.getState();
    expect(s.modem).toBeNull();
    expect(s.ethernetConfig).toBeNull();
    expect(s.wifiScan).toEqual({
      results: [],
      scanning: false,
      scannedAt: null,
      error: null,
    });
    expect(s.uplink).toEqual(EMPTY_UPLINK);
  });

  it("resetAll clears scan results back to empty", () => {
    useGroundStationStore.setState({
      wifiScan: {
        results: [{ ssid: "test", signal: -50 } as never],
        scanning: false,
        scannedAt: 1700000000,
        error: null,
      },
    });
    useGroundStationStore.getState().resetAll();
    expect(useGroundStationStore.getState().wifiScan.results).toEqual([]);
    expect(useGroundStationStore.getState().wifiScan.scannedAt).toBeNull();
  });

  it("resetAll restores uplink priority to its empty default", () => {
    useGroundStationStore.setState({
      uplink: {
        ...EMPTY_UPLINK,
        active: "wifi",
        priority: ["wifi", "ethernet", "modem"],
        health: "degraded",
      },
    });
    useGroundStationStore.getState().resetAll();
    expect(useGroundStationStore.getState().uplink.active).toBeNull();
    expect(useGroundStationStore.getState().uplink.priority).toEqual([]);
    expect(useGroundStationStore.getState().uplink.health).toBeNull();
  });

  describe("toggleShareUplink", () => {
    it("records applied:false + reason from the agent response", async () => {
      const api = makeApi({
        enabled: true,
        applied: false,
        apply_error: "no_active_uplink",
        backend: null,
      });

      const ret = await useGroundStationStore
        .getState()
        .toggleShareUplink(api, true);

      expect(ret).toBe(true);
      const u = useGroundStationStore.getState().uplink;
      expect(u.shareUplinkApplied).toBe(false);
      expect(u.shareUplinkAppliedReason).toBe("no_active_uplink");
    });

    it("clears the reason when the rule applies", async () => {
      // Seed a prior failed-apply state so we prove it gets cleared.
      useGroundStationStore.setState({
        uplink: {
          ...EMPTY_UPLINK,
          shareUplinkApplied: false,
          shareUplinkAppliedReason: "no_active_uplink",
        },
      });

      const api = makeApi({
        enabled: true,
        applied: true,
        apply_error: null,
        backend: "iptables-persistent",
      });

      await useGroundStationStore.getState().toggleShareUplink(api, true);

      const u = useGroundStationStore.getState().uplink;
      expect(u.shareUplinkApplied).toBe(true);
      expect(u.shareUplinkAppliedReason).toBeNull();
    });

    it("treats a legacy response without `applied` as success", async () => {
      const api = makeApi({ enabled: false });

      await useGroundStationStore.getState().toggleShareUplink(api, false);

      const u = useGroundStationStore.getState().uplink;
      expect(u.shareUplinkApplied).toBe(true);
      expect(u.shareUplinkAppliedReason).toBeNull();
    });
  });
});
