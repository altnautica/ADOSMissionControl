/**
 * @module nodes/node-badges.test
 * @description The sidebar badge candidates stay honest to the reported
 * fields: an unreported ground-station role reads as unknown (never "Direct"),
 * and a companion drone's "FC + SBC" badge follows its FC link and liveness.
 *
 * @license GPL-3.0-only
 */

import { describe, expect, it } from "vitest";
import { nodeBadges, type NodeBadgeLabels } from "../NodeBadgeSet";
import type { FleetNodeEntry } from "@/hooks/use-fleet-nodes";

const LABELS: NodeBadgeLabels = {
  offline: "Offline",
  stale: "Stale",
  relay: "Relay",
  receiver: "Receiver",
  direct: "Direct",
  roleUnknown: "Role unknown",
  compute: "Compute",
  fc: "FC",
  companion: "FC + SBC",
};

function node(over: Partial<FleetNodeEntry> = {}): FleetNodeEntry {
  return {
    _id: "node:n1",
    userId: "u",
    deviceId: "n1",
    name: "Node 1",
    apiKey: "",
    pairedAt: Date.now(),
    lastSeen: Date.now(),
    profile: "drone",
    isLocal: false,
    ...over,
  };
}

describe("nodeBadges ground-station role", () => {
  it.each([null, undefined])("reads an unreported role (%s) as unknown", (role) => {
    const badges = nodeBadges(node({ profile: "ground-station", role }), "ground-station", LABELS);
    expect(badges.find((b) => b.key === "role")?.label).toBe("Role unknown");
  });

  it("labels a reported direct role as Direct", () => {
    const badges = nodeBadges(
      node({ profile: "ground-station", role: "direct" }),
      "ground-station",
      LABELS,
    );
    expect(badges.find((b) => b.key === "role")?.label).toBe("Direct");
  });
});

describe("nodeBadges companion drone", () => {
  it("warns when the companion drone's FC is not reachable", () => {
    const badges = nodeBadges(node({ board: "rpi-cm4", fcConnected: false }), "drone", LABELS);
    const companion = badges.find((b) => b.key === "companion");
    expect(companion?.label).toBe("FC + SBC");
    expect(companion?.variant).toBe("warning");
  });

  it("is green only when the FC link is up", () => {
    const badges = nodeBadges(node({ board: "rpi-cm4", fcConnected: true }), "drone", LABELS);
    expect(badges.find((b) => b.key === "companion")?.variant).toBe("success");
  });

  it("collapses to the offline badge alone when the node went offline", () => {
    const badges = nodeBadges(
      node({ board: "rpi-cm4", fcConnected: true, lastSeen: Date.now() - 3_600_000 }),
      "drone",
      LABELS,
    );
    expect(badges.map((b) => b.key)).toEqual(["offline"]);
  });

  it("shows no live FC badge on a stale FC-only drone, only the stale badge and identity", () => {
    const badges = nodeBadges(
      node({ fcConnected: true, fcFirmware: "ardupilot", lastSeen: Date.now() - 50_000 }),
      "drone",
      LABELS,
    );
    expect(badges.map((b) => b.key)).toEqual(["stale", "flavor"]);
  });
});
