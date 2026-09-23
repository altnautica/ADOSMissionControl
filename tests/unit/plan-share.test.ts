/**
 * Client-only share links: a plan round-trips losslessly through encode→decode, and
 * any malformed / tampered / oversized fragment decodes to null (never a partial plan).
 * @license GPL-3.0-only
 */
import { describe, it, expect } from "vitest";
import {
  buildMissionFile,
  encodePlan,
  decodePlan,
  makeShareLink,
  buildShareUrl,
  readPlanFromHash,
  SHARE_MAX_ENCODED_LEN,
} from "@/lib/plan-share";
import type { Waypoint } from "@/lib/types";
import { MISSION_FILE_VERSION, type MissionMetadata } from "@/lib/mission-io";

const META: MissionMetadata = { name: "Test Mission", createdAt: 1000, updatedAt: 2000 };
const WPS: Waypoint[] = [
  { id: "a", lat: 12.5, lon: 77.5, alt: 50, command: "WAYPOINT" },
  { id: "b", lat: 12.51, lon: 77.51, alt: 60, command: "WAYPOINT" },
];

describe("plan-share round-trip", () => {
  it("encodes and decodes a plan losslessly", () => {
    const file = buildMissionFile(WPS, META);
    const decoded = decodePlan(encodePlan(file));
    expect(decoded).not.toBeNull();
    expect(decoded!.waypoints).toHaveLength(2);
    expect(decoded!.waypoints[0].lat).toBeCloseTo(12.5);
    expect(decoded!.metadata.name).toBe("Test Mission");
    expect(decoded!.version).toBe(MISSION_FILE_VERSION);
  });

  it("keeps nested waypoint actions intact across the round trip", () => {
    const withActions: Waypoint[] = [
      {
        id: "a",
        lat: 12.5,
        lon: 77.5,
        alt: 50,
        command: "WAYPOINT",
        actions: [
          { id: "act1", command: "DO_SET_CAM_TRIGG", param1: 25 },
          { id: "act2", command: "DO_SET_SPEED", param2: 6 },
        ],
      },
      WPS[1],
    ];
    const decoded = decodePlan(encodePlan(buildMissionFile(withActions, META)));
    expect(decoded!.waypoints).toHaveLength(2);
    expect(decoded!.waypoints[0].actions?.map((a) => a.command)).toEqual([
      "DO_SET_CAM_TRIGG",
      "DO_SET_SPEED",
    ]);
  });

  it("stamps the current schema so current-layout slots are not migrated again", () => {
    const place: Waypoint[] = [{ id: "p", lat: 12.5, lon: 77.5, alt: 20, command: "NAV_PAYLOAD_PLACE", param1: 5 }];
    const decoded = decodePlan(encodePlan(buildMissionFile(place, META)));
    expect(decoded!.waypoints[0].param1).toBe(5);
    expect(decoded!.waypoints[0].holdTime).toBeUndefined();
  });

  it("carries geofence + rally extras when present", () => {
    const file = buildMissionFile(WPS, META, {
      geofence: { enabled: true, fenceType: "circle", circleCenter: [12.5, 77.5], circleRadius: 100 },
      rally: [{ id: "r1", lat: 12.5, lon: 77.5, alt: 40 }],
    } as never);
    const decoded = decodePlan(encodePlan(file));
    expect(decoded!.geofence).toBeDefined();
    expect(decoded!.rally).toHaveLength(1);
  });

  it("carries plan points of interest", () => {
    const file = buildMissionFile(WPS, META, {
      pois: [{ id: "p1", lat: 12.5, lon: 77.5, label: "Mast" }],
    } as never);
    expect(decodePlan(encodePlan(file))!.pois).toHaveLength(1);
  });

  it("reads a plan from a URL hash string", () => {
    const encoded = encodePlan(buildMissionFile(WPS, META));
    expect(readPlanFromHash(`#plan=${encoded}`)).not.toBeNull();
    expect(readPlanFromHash(`plan=${encoded}`)).not.toBeNull();
  });

  it("builds a share URL", () => {
    expect(buildShareUrl("https://x.test", "/plan", "ABC")).toBe("https://x.test/plan#plan=ABC");
  });
});

describe("plan-share defensive decode", () => {
  it("rejects an empty / non-base64 / non-deflate fragment", () => {
    expect(decodePlan("")).toBeNull();
    expect(decodePlan("!!!not base64!!!")).toBeNull();
    expect(decodePlan("aGVsbG8")).toBeNull(); // valid base64 ("hello") but not deflate
  });

  it("rejects a fragment whose JSON is not a valid mission shape", () => {
    // Encode arbitrary (non-mission) JSON and confirm it does not decode to a plan.
    const badFile = { version: 2, waypoints: "nope" } as never;
    expect(decodePlan(encodePlan(badFile))).toBeNull();
  });

  it("rejects a plan whose waypoints have a non-numeric position or an unknown command", () => {
    const bad = (wp: unknown) =>
      decodePlan(encodePlan({ version: 3, metadata: META, waypoints: [WPS[0], wp] } as never));
    expect(bad({ id: "x", lat: "12.5", lon: 77.5, alt: 50 })).toBeNull();
    expect(bad({ id: "x", lat: null, lon: 77.5, alt: 50 })).toBeNull();
    expect(bad({ id: "x", lat: 12.5, lon: 77.5, alt: 50, command: "SELF_DESTRUCT" })).toBeNull();
    expect(
      bad({ id: "x", lat: 12.5, lon: 77.5, alt: 50, actions: [{ id: "a", command: "NOPE" }] }),
    ).toBeNull();
    expect(bad({ id: "x", lat: 12.5, lon: 77.5, alt: 50 })).not.toBeNull();
  });

  it("rejects an unknown file version", () => {
    expect(decodePlan(encodePlan({ version: 9, metadata: META, waypoints: WPS } as never))).toBeNull();
  });

  it("reports oversized plans via makeShareLink instead of a bad link", () => {
    const many: Waypoint[] = Array.from({ length: 4000 }, (_, i) => ({
      id: `w${i}`, lat: 12.5 + i * 1e-5, lon: 77.5, alt: 50, command: "WAYPOINT",
    }));
    const res = makeShareLink(buildMissionFile(many, META));
    expect(res.tooLarge).toBe(true);
    expect(res.encoded).toBeNull();
    expect(res.length).toBeGreaterThan(SHARE_MAX_ENCODED_LEN);
  });
});
