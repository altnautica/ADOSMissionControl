/**
 * @module api/ground-station/__tests__/status
 * @description The ground-station `/status` normaliser carries the agent's
 * auto-pair re-arm (`link.pair_rearm`), and the shared rule turns a running
 * mis-keyed re-pair into the `gs_repairing` banner.
 * @license GPL-3.0-only
 */

import { describe, expect, it } from "vitest";
import { normaliseGroundStationStatus } from "../status";
import { repairingMisKeyed } from "@/lib/hud/status-pill";

const body = (pair_rearm: unknown) => ({
  profile: "ground-station",
  paired_drone: { device_id: "alpha-1" },
  link: { rssi_dbm: -60, link_diag: "mis_keyed", pair_rearm },
});

describe("normaliseGroundStationStatus pair_rearm", () => {
  it("carries a running mis-keyed re-pair", () => {
    const s = normaliseGroundStationStatus(
      body({ cause: "mis_keyed", active: true, at: 700, episodes: 1 }),
    );
    expect(s.pair_rearm).toEqual({ cause: "mis_keyed", active: true, at: 700, episodes: 1 });
    expect(repairingMisKeyed(s.pair_rearm)).toBe(true);
  });

  it("reads an absent or malformed re-arm as none", () => {
    expect(normaliseGroundStationStatus(body(undefined)).pair_rearm).toBeNull();
    expect(normaliseGroundStationStatus(body([1])).pair_rearm).toBeNull();
    expect(normaliseGroundStationStatus({}).pair_rearm).toBeNull();
  });

  it("does not banner another cause or a finished window", () => {
    const unproven = normaliseGroundStationStatus(body({ cause: "unproven", active: true }));
    expect(repairingMisKeyed(unproven.pair_rearm)).toBe(false);
    const done = normaliseGroundStationStatus(body({ cause: "mis_keyed", active: false }));
    expect(repairingMisKeyed(done.pair_rearm)).toBe(false);
    expect(done.pair_rearm?.active).toBe(false);
  });
});
