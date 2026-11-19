/**
 * @module mock/ground-station-uplink
 * @description In-memory radio uplink of the demo ground station. It starts in
 * standby with a phone holding the uplink and answers the read and the
 * take-back with the agent's reply shapes, so the Radio tab's uplink card runs
 * its real path in demo.
 * @license GPL-3.0-only
 */

import type { RadioUplink, RadioUplinkTakeBackResult } from "@/lib/api/ground-station/uplink-handover";

/** The demo phone holding the uplink. */
export const DEMO_UPLINK_HOLDER = { device_id: "demo-phone-0001", name: "Pilot tablet" } as const;

/** How long before the demo opened the phone took the uplink. */
const DEMO_HELD_FOR_MS = 6 * 60_000;

function standby(now: number): RadioUplink {
  return {
    state: "standby",
    holder_device_id: DEMO_UPLINK_HOLDER.device_id,
    holder_name: DEMO_UPLINK_HOLDER.name,
    since_ms: now - DEMO_HELD_FOR_MS,
    last_beacon_ms: now,
  };
}

class DemoGroundStationUplink {
  private uplink: RadioUplink = standby(Date.now());

  /** Back to the seeded standby. */
  reset(now = Date.now()): void {
    this.uplink = standby(now);
  }

  /** `GET /api/v1/ground-station/uplink`'s `uplink`. The phone's beacon is
   * heard every second while it holds the uplink. */
  get(now = Date.now()): RadioUplink {
    if (this.uplink.state === "standby") this.uplink = { ...this.uplink, last_beacon_ms: now };
    return { ...this.uplink };
  }

  /** `POST /api/v1/ground-station/uplink {op: "take_back"}`. */
  takeBack(now = Date.now()): RadioUplinkTakeBackResult {
    this.uplink = {
      state: "transmitting",
      holder_device_id: null,
      holder_name: null,
      since_ms: now,
      last_beacon_ms: null,
    };
    return { ok: true, state: "transmitting", uplink: { ...this.uplink } };
  }
}

export const demoGroundStationUplink = new DemoGroundStationUplink();
