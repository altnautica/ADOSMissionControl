/**
 * @module command/settings/__tests__/use-node-host
 * @description The `/api/status` host fields decide which settings a node is
 * offered, so the parse contract matters more than the fetch: an unknown or
 * absent value must read as an appliance (the configuration every node had
 * before the field existed), and a personal host must never be read as shared
 * unless it says so.
 * @license GPL-3.0-only
 */

import { describe, expect, it } from "vitest";

import { parseNodeHost } from "../use-node-host";

describe("parseNodeHost", () => {
  it("reads a personal ground station that is not shared", () => {
    expect(
      parseNodeHost({ host_kind: "personal", share_on_lan: false }),
    ).toEqual({ hostKind: "personal", shareOnLan: false });
  });

  it("reads a personal ground station the operator shared", () => {
    expect(
      parseNodeHost({ host_kind: "personal", share_on_lan: true }),
    ).toEqual({ hostKind: "personal", shareOnLan: true });
  });

  it("treats a personal host with no flag as not shared", () => {
    // A node written by an older agent, or one whose config has no `host:`
    // block, must not be read as exposed.
    expect(parseNodeHost({ host_kind: "personal" })).toEqual({
      hostKind: "personal",
      shareOnLan: false,
    });
  });

  it("treats an appliance as reachable whatever the flag says", () => {
    expect(
      parseNodeHost({ host_kind: "appliance", share_on_lan: false }),
    ).toEqual({ hostKind: "appliance", shareOnLan: true });
  });

  it("falls back to an appliance for an absent or unknown body", () => {
    const appliance = { hostKind: "appliance", shareOnLan: true };
    expect(parseNodeHost(null)).toEqual(appliance);
    expect(parseNodeHost(undefined)).toEqual(appliance);
    expect(parseNodeHost({})).toEqual(appliance);
    expect(parseNodeHost({ host_kind: "tower" })).toEqual(appliance);
    expect(parseNodeHost("personal")).toEqual(appliance);
  });
});
