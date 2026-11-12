/**
 * The demo roster: which drones the demo fleet flies, which of them are LAN
 * paired, which one has its vision engine off, and which swarm conditions sit
 * on which drone.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import { DEMO_DRONES } from "@/mock/drones";
import { FLIGHT_PATHS } from "@/mock/flight-paths";
import { VISION_OFF_DEMO_DRONE } from "@/mock/mock-detections";
import { DEMO_LAN_NODE_IDS } from "@/lib/demo/demo-ids";
import { demoSwarmNeighborsPayload } from "@/mock/swarm-beacons";

interface WireRow {
  device_id: string;
  armed: boolean;
  emergency: boolean;
  gps_ok: boolean;
  age_ms: number;
  rssi_dbm: number;
}

describe("demo roster", () => {
  it("flies eleven drones", () => {
    expect(DEMO_DRONES.map((d) => d.id)).toEqual([
      "alpha-1",
      "bravo-2",
      "charlie-3",
      "delta-4",
      "echo-5",
      "golf-7",
      "hotel-8",
      "india-9",
      "juliet-10",
      "lima-12",
      "november-14",
    ]);
  });

  it("points every drone at an existing flight path", () => {
    for (const d of DEMO_DRONES) {
      expect(FLIGHT_PATHS[d.pathIndex], d.id).toBeDefined();
    }
  });

  it("references only drones on the roster", () => {
    const ids = new Set(DEMO_DRONES.map((d) => d.id));
    for (const id of [...DEMO_LAN_NODE_IDS, VISION_OFF_DEMO_DRONE]) {
      expect(ids.has(id), id).toBe(true);
    }
  });

  it("puts each swarm condition on its named drone", () => {
    const payload = demoSwarmNeighborsPayload(0) as {
      neighbors: WireRow[];
      slots: { slot: number; device_id: string }[];
    };
    const row = (id: string): WireRow => {
      const found = payload.neighbors.find((n) => n.device_id === id);
      expect(found, id).toBeDefined();
      return found!;
    };

    expect(row("echo-5").emergency).toBe(true);
    expect(row("india-9").gps_ok).toBe(false);
    expect(row("juliet-10").armed).toBe(false);
    expect(row("lima-12").age_ms).toBeGreaterThan(4000);
    expect(row("lima-12").rssi_dbm).toBe(-92);
    expect(row("november-14").rssi_dbm).toBe(-84);

    expect(payload.neighbors.filter((n) => n.emergency).map((n) => n.device_id)).toEqual(["echo-5"]);
    expect(payload.neighbors.filter((n) => n.rssi_dbm <= -80)).toHaveLength(2);

    // Every registered slot beacons: no silent slot for a drone the demo does not fly.
    const flown = new Set(DEMO_DRONES.map((d) => d.id));
    expect(payload.slots.every((s) => flown.has(s.device_id))).toBe(true);
    expect(payload.slots).toHaveLength(payload.neighbors.length);
  });
});
