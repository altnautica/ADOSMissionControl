/**
 * Tests for the bearer derivation: which link carries a node, whether a node is
 * shown as multi-path, and how honestly a WFB link's verification is reported.
 *
 * The board must never dress a link up as proven when it is not: a relayed drone
 * with no heard frame reads unverified, a dark one reads down, and a directly-
 * reached drone's secondary WFB provenance is never green (Rule 44 / Rule 37).
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";

import { deriveNodeBearers } from "@/lib/nodes/node-bearer";
import type { DeriveNodeBearersInput } from "@/lib/nodes/node-bearer";

const base: DeriveNodeBearersInput = {
  reachKind: "none",
  isRelayed: false,
  hasReachedVia: false,
  reachedViaName: null,
  wfbRssiDbm: null,
  liveness: "live",
};

describe("deriveNodeBearers — relayed-only drone", () => {
  it("makes WFB the primary bearer and names its ground node", () => {
    const { primary, secondary } = deriveNodeBearers({
      ...base,
      reachKind: "none",
      isRelayed: true,
      reachedViaName: "Ground A",
      wfbRssiDbm: -51,
    });

    expect(primary.kind).toBe("wfb");
    expect(primary.viaName).toBe("Ground A");
    expect(secondary).toBeNull();
  });

  it("reads verified only when the ground node heard a frame", () => {
    const heard = deriveNodeBearers({
      ...base,
      isRelayed: true,
      wfbRssiDbm: -51,
      liveness: "live",
    });
    expect(heard.primary.verification).toBe("verified");
    expect(heard.primary.rssiDbm).toBe(-51);
  });

  it("reads unverified when no received-side signal is known", () => {
    const unheard = deriveNodeBearers({
      ...base,
      isRelayed: true,
      wfbRssiDbm: null,
      liveness: "live",
    });
    expect(unheard.primary.verification).toBe("unverified");
    expect(unheard.primary.rssiDbm).toBeNull();
  });

  it("reads stale when the node has gone quiet but was last heard", () => {
    const stale = deriveNodeBearers({
      ...base,
      isRelayed: true,
      wfbRssiDbm: -60,
      liveness: "stale",
    });
    expect(stale.primary.verification).toBe("stale");
  });

  it("reads down when the node is offline, whatever the last signal was", () => {
    const down = deriveNodeBearers({
      ...base,
      isRelayed: true,
      wfbRssiDbm: -51,
      liveness: "offline",
    });
    expect(down.primary.verification).toBe("down");
  });
});

describe("deriveNodeBearers — directly-reached node", () => {
  it("shows LAN as the primary bearer, verified", () => {
    const { primary, secondary } = deriveNodeBearers({
      ...base,
      reachKind: "lan",
    });
    expect(primary.kind).toBe("lan");
    expect(primary.verification).toBe("verified");
    expect(secondary).toBeNull();
  });

  it("shows a muted, unverified WFB secondary for a multi-path node", () => {
    const { primary, secondary } = deriveNodeBearers({
      ...base,
      reachKind: "lan",
      hasReachedVia: true,
      reachedViaName: "Ground A",
    });
    expect(primary.kind).toBe("lan");
    expect(secondary).not.toBeNull();
    expect(secondary!.kind).toBe("wfb");
    expect(secondary!.viaName).toBe("Ground A");
    // The signal lives on the ground node's row, not here — never a confident
    // verdict from a link this row cannot prove.
    expect(secondary!.verification).toBe("unverified");
    expect(secondary!.rssiDbm).toBeNull();
  });

  it("drops the secondary provenance chip on an offline node", () => {
    const { secondary } = deriveNodeBearers({
      ...base,
      reachKind: "lan",
      hasReachedVia: true,
      reachedViaName: "Ground A",
      liveness: "offline",
    });
    expect(secondary).toBeNull();
  });

  it("keeps a cloud node as its own primary bearer", () => {
    const { primary } = deriveNodeBearers({ ...base, reachKind: "cloud" });
    expect(primary.kind).toBe("cloud");
    expect(primary.verification).toBe("verified");
  });

  it("keeps a direct FC as its own bearer, not a relay", () => {
    const { primary, secondary } = deriveNodeBearers({
      ...base,
      reachKind: "direct-fc",
    });
    expect(primary.kind).toBe("direct-fc");
    expect(secondary).toBeNull();
  });

  it("reads an unreachable node as a down bearer", () => {
    const { primary } = deriveNodeBearers({ ...base, reachKind: "none" });
    expect(primary.kind).toBe("none");
    expect(primary.verification).toBe("down");
  });
});
