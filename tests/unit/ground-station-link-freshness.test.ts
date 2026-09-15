/**
 * @description Ground-station link readings: which source speaks, and when a
 * reading stops being one.
 *
 * Two defects, both of which made the Radio tab and the Overview link card
 * report a healthy radio when nothing was being received:
 *   - the un-timestamped Convex cloud row was preferred over the 2 Hz LAN poll,
 *     with no staleness check at all, so an hour-old heartbeat beat the agent
 *     sitting on the same network;
 *   - `linkHealth` was never invalidated on a failed poll, so a non-null RSSI
 *     latched `connected` forever.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  pickRadioFromCloud,
  resolveRadioSource,
  CLOUD_ROW_MAX_AGE_MS,
} from "@/components/hardware/radio/cloud-radio";
import { useGroundStationStore } from "@/stores/ground-station-store";
import { LAN_SNAPSHOT_STALE_MS } from "@/stores/ground-station/link-store";

const NOW = 1_700_000_000_000;
const DEVICE = "gs-device-1";

function cloudRow(over: Record<string, unknown> = {}) {
  return [
    {
      drone: { deviceId: DEVICE, mdnsHost: "ados-gs.local" },
      status: {
        deviceId: DEVICE,
        radio: { rssiDbm: -40, state: "connected", snrDb: 28 },
        ...over,
      },
    },
  ];
}

describe("cloud radio row freshness", () => {
  it("carries the row's own timestamp so the panel can judge it", () => {
    const picked = pickRadioFromCloud(cloudRow({ updatedAt: NOW }), DEVICE);
    expect(picked.radio?.rssiDbm).toBe(-40);
    expect(picked.updatedAt).toBe(NOW);
  });

  it("reports no timestamp when the row carries none", () => {
    expect(pickRadioFromCloud(cloudRow(), DEVICE).updatedAt).toBeNull();
  });
});

describe("resolveRadioSource", () => {
  it("prefers the LAN poll over a cloud row that is not proven newer", () => {
    const s = resolveRadioSource({
      cloudUpdatedAt: NOW - 5_000,
      lanFetchedAt: NOW - 500,
      now: NOW,
    });
    expect(s.lanFresh).toBe(true);
    expect(s.cloudFresh).toBe(true);
    expect(s.cloudWinsShared).toBe(false);
  });

  it("never lets an un-timestamped cloud row beat a fresh LAN poll", () => {
    const s = resolveRadioSource({
      cloudUpdatedAt: null,
      lanFetchedAt: NOW - 500,
      now: NOW,
    });
    expect(s.cloudFresh).toBe(false);
    expect(s.cloudWinsShared).toBe(false);
  });

  it("treats a cloud row older than the max age as no reading at all", () => {
    const s = resolveRadioSource({
      cloudUpdatedAt: NOW - CLOUD_ROW_MAX_AGE_MS - 1,
      lanFetchedAt: null,
      now: NOW,
    });
    expect(s.cloudFresh).toBe(false);
    expect(s.lanFresh).toBe(false);
    expect(s.cloudWinsShared).toBe(false);
  });

  it("lets the cloud row speak when it proves it is newer than the LAN snapshot", () => {
    const s = resolveRadioSource({
      cloudUpdatedAt: NOW - 200,
      lanFetchedAt: NOW - 2_000,
      now: NOW,
    });
    expect(s.cloudWinsShared).toBe(true);
  });

  it("falls back to a fresh cloud row once the LAN snapshot goes stale", () => {
    const s = resolveRadioSource({
      cloudUpdatedAt: NOW - 1_000,
      lanFetchedAt: NOW - LAN_SNAPSHOT_STALE_MS - 1,
      now: NOW,
    });
    expect(s.lanFresh).toBe(false);
    expect(s.cloudWinsShared).toBe(true);
  });

  it("treats a never-polled LAN snapshot as no reading", () => {
    const s = resolveRadioSource({
      cloudUpdatedAt: null,
      lanFetchedAt: null,
      now: NOW,
    });
    expect(s.lanFresh).toBe(false);
    expect(s.cloudFresh).toBe(false);
  });
});

describe("link health invalidation", () => {
  beforeEach(() => {
    useGroundStationStore.getState().reset();
  });

  it("drops the snapshot when the poll fails, so a dead link reads dead", () => {
    const store = useGroundStationStore.getState();
    store.loadStatus(
      { paired_drone: "d1", profile: "ground_station", uplink_active: null },
      { rssi_dbm: -58, bitrate_mbps: 18.5, fec_rec: 3, fec_lost: 0, channel: 161 },
    );
    expect(useGroundStationStore.getState().linkHealth.rssi_dbm).toBe(-58);
    expect(useGroundStationStore.getState().lastFetchedAt).not.toBeNull();

    useGroundStationStore.getState().invalidateLinkHealth("fetch failed");

    const after = useGroundStationStore.getState();
    // Every value gone, not merged over: the card renders "—", and the
    // no-longer-set fetch stamp is what makes every derived reading unknown.
    expect(after.linkHealth.rssi_dbm).toBeNull();
    expect(after.linkHealth.bitrate_mbps).toBeNull();
    expect(after.linkHealth.channel).toBeNull();
    expect(after.linkHealth.fec_rec).toBe(0);
    expect(after.lastFetchedAt).toBeNull();
    expect(after.lastError).toBe("fetch failed");
  });

  it("no longer reads as a live snapshot after invalidation", () => {
    const store = useGroundStationStore.getState();
    store.loadStatus(
      { paired_drone: null, profile: "ground_station", uplink_active: null },
      { rssi_dbm: -58, bitrate_mbps: 18.5, fec_rec: 0, fec_lost: 0, channel: 161 },
    );
    store.invalidateLinkHealth("fetch failed");

    const s = resolveRadioSource({
      cloudUpdatedAt: null,
      lanFetchedAt: useGroundStationStore.getState().lastFetchedAt,
      now: Date.now(),
    });
    expect(s.lanFresh).toBe(false);
    expect(s.cloudWinsShared).toBe(false);
  });
});
