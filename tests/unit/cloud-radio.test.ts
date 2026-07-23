/**
 * @module cloud-radio.test
 * @description pickRadioFromCloud must render the radio block of the node
 * whose panel is asking, keyed by deviceId — never "the freshest row that
 * carries any radio block", which would render one node's link on another
 * node's panel (Rule 44).
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import { pickRadioFromCloud } from "@/components/hardware/radio/cloud-radio";
import type { RadioState } from "@/lib/api/ground-station/types";

/** Minimal RadioState carrying only the fields this test asserts on; the
 * picker returns the block verbatim, so a partial shape cast is enough. */
function radio(state: RadioState["state"], iface: string): RadioState {
  return { state, iface } as unknown as RadioState;
}

// Two distinct nodes, each with its own radio block. Node A is the STALER row
// (an earlier updatedAt) so the retired "freshest anywhere" logic would have
// picked node B's radio for node A's panel.
const rows = [
  {
    drone: { deviceId: "node-a", name: "Node A", mdnsHost: "node-a.local" },
    status: { deviceId: "node-a", updatedAt: 1000, radio: radio("connected", "wlan-a") },
  },
  {
    drone: { deviceId: "node-b", name: "Node B", mdnsHost: "node-b.local" },
    status: { deviceId: "node-b", updatedAt: 9000, radio: radio("rf_unverified", "wlan-b") },
  },
];

describe("pickRadioFromCloud", () => {
  it("renders each node's radio on its OWN panel, not cross-contaminated", () => {
    const a = pickRadioFromCloud(rows, "node-a");
    expect(a.radio?.iface).toBe("wlan-a");
    expect(a.radio?.state).toBe("connected");
    expect(a.hostname).toBe("node-a.local");

    const b = pickRadioFromCloud(rows, "node-b");
    expect(b.radio?.iface).toBe("wlan-b");
    expect(b.radio?.state).toBe("rf_unverified");
    expect(b.hostname).toBe("node-b.local");
  });

  it("returns nulls when the node's deviceId is unknown", () => {
    expect(pickRadioFromCloud(rows, null)).toEqual({
      radio: null,
      hostname: null,
    });
  });

  it("returns nulls when no row matches this node (never borrows a peer's radio)", () => {
    expect(pickRadioFromCloud(rows, "node-c")).toEqual({
      radio: null,
      hostname: null,
    });
  });

  it("returns nulls when this node's row carries no radio block", () => {
    const noRadio = [
      { drone: { deviceId: "node-a" }, status: { deviceId: "node-a" } },
    ];
    expect(pickRadioFromCloud(noRadio, "node-a")).toEqual({
      radio: null,
      hostname: null,
    });
  });

  it("returns nulls for empty or non-array input", () => {
    expect(pickRadioFromCloud([], "node-a")).toEqual({
      radio: null,
      hostname: null,
    });
    expect(pickRadioFromCloud(undefined, "node-a")).toEqual({
      radio: null,
      hostname: null,
    });
  });
});
