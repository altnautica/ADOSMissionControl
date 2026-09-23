/**
 * The flight-log upsert validator rejects any key it does not declare, so a
 * record pushed to the cloud has to match it exactly. These tests run a
 * complete FlightRecord, as the live flight lifecycle produces it, through
 * the payload builder and then through the upsert mutation's own argument
 * validator (read from the Convex function definition).
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import { upsert } from "../../../../convex/cmdFlightLogs";
import { toCloudShape, fromCloudShape, SYNCED_FLIGHT_KEYS } from "../cloud-sync-shape";
import type { FlightRecord } from "@/lib/types";

type Validator =
  | { type: "string" | "number" | "boolean" | "any" | "null" | "int64" | "bytes" }
  | { type: "literal"; value: unknown }
  | { type: "array"; value: Validator }
  | { type: "union"; value: Validator[] }
  | { type: "object"; value: Record<string, { fieldType: Validator; optional: boolean }> };

/** The upsert mutation's `record` argument validator, as Convex exports it. */
const recordValidator = (() => {
  const fn: unknown = upsert;
  if (
    (typeof fn !== "function" && typeof fn !== "object") ||
    fn === null ||
    !("exportArgs" in fn) ||
    typeof fn.exportArgs !== "function"
  ) {
    throw new Error("upsert does not expose its argument validator");
  }
  // Convex's own serialisation of the validator, parsed into its documented shape.
  const args: { value: { record: { fieldType: Validator } } } = JSON.parse(String(fn.exportArgs()));
  return args.value.record.fieldType;
})();

/** Violations of `validator` by `value`, as dotted paths. Empty when it matches. */
function check(validator: Validator, value: unknown, path: string): string[] {
  switch (validator.type) {
    case "any":
      return [];
    case "string":
    case "number":
    case "boolean":
      return typeof value === validator.type ? [] : [`${path}: expected ${validator.type}`];
    case "literal":
      return value === validator.value ? [] : [`${path}: expected ${String(validator.value)}`];
    case "array":
      if (!Array.isArray(value)) return [`${path}: expected array`];
      return value.flatMap((v, i) => check(validator.value, v, `${path}[${i}]`));
    case "union":
      return validator.value.some((v) => check(v, value, path).length === 0)
        ? []
        : [`${path}: matches no union member`];
    case "object": {
      if (typeof value !== "object" || value === null) return [`${path}: expected object`];
      const obj = value as Record<string, unknown>;
      const errors: string[] = [];
      for (const key of Object.keys(obj)) {
        if (!(key in validator.value)) errors.push(`${path}.${key}: extra field`);
      }
      for (const [key, field] of Object.entries(validator.value)) {
        if (obj[key] === undefined) {
          if (!field.optional) errors.push(`${path}.${key}: missing`);
          continue;
        }
        errors.push(...check(field.fieldType, obj[key], `${path}.${key}`));
      }
      return errors;
    }
    default:
      return [`${path}: unsupported validator ${validator.type}`];
  }
}

/** A finished live flight with the arm-time snapshots the lifecycle freezes. */
function liveFlight(): FlightRecord {
  const start = 1_760_000_000_000;
  return {
    id: "flight-1",
    droneId: "drone-1",
    droneName: "Alpha",
    date: start,
    startTime: start,
    endTime: start + 600_000,
    duration: 600,
    distance: 1234,
    maxAlt: 45,
    maxSpeed: 12.3,
    avgSpeed: 6.1,
    batteryUsed: 38,
    batteryStartV: 25.1,
    batteryEndV: 22.4,
    waypointCount: 4,
    status: "completed",
    path: [[12.97, 77.59], [12.98, 77.6]],
    takeoffLat: 12.97,
    takeoffLon: 77.59,
    landingLat: 12.98,
    landingLon: 77.6,
    recordingId: "rec-1",
    hasTelemetry: true,
    updatedAt: start + 601_000,
    events: [{ t: 0, type: "takeoff", severity: "info", label: "Takeoff" }],
    flags: [],
    health: { avgSatellites: 14 },
    pilotFirstName: "Sam",
    pilotLicenseNumber: "LIC-42",
    aircraftRegistration: "REG-001",
    aircraftMtomKg: 2.4,
    cloudSynced: false,
    source: "live",
    loadout: { batteryIds: ["bat-1"] },
    phases: [{ type: "cruise", startMs: 0, endMs: 1000, maxAlt: 40 }],
    windEstimate: { speedMs: 3, fromDirDeg: 270, sampleCount: 40, method: "vfr_diff" },
    geofenceSnapshot: { enabled: true, maxAltitude: 120 },
    media: [{ id: "m1", name: "a.jpg", type: "image/jpeg", size: 10, capturedAt: start, blobKey: "media:flight-1:m1" }],
  };
}

describe("flight-log cloud payload", () => {
  it("passes the upsert validator for a live flight record", () => {
    const payload = toCloudShape(liveFlight());
    expect(check(recordValidator, payload, "record")).toEqual([]);
    expect(payload.clientId).toBe("flight-1");
  });

  it("syncs exactly the fields the validator declares", () => {
    if (recordValidator.type !== "object") throw new Error("record validator is not an object");
    const declared = Object.keys(recordValidator.value).filter((k) => k !== "clientId").sort();
    expect([...SYNCED_FLIGHT_KEYS].sort()).toEqual(declared);
  });

  it("round-trips a cloud row back into a record with its local date", () => {
    const record = liveFlight();
    const back = fromCloudShape({ ...toCloudShape(record), _id: "x", _creationTime: 1, userId: "u" });
    expect(back.id).toBe(record.id);
    expect(back.date).toBe(record.startTime);
    expect(back.maxAlt).toBe(record.maxAlt);
  });
});
