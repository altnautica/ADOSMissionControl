import { describe, expect, it } from "vitest";

import { nodeToOffloadAddr } from "../offload-target";

describe("nodeToOffloadAddr", () => {
  it("uses the paired host with the compute job-API port (:8092), not the control front (:8080)", () => {
    // A workstation paired on the control front :8080 must still be dialed on
    // the compute engine's own port for offload jobs.
    expect(nodeToOffloadAddr({ hostname: "http://192.168.1.5:8080" })).toBe(
      "192.168.1.5:8092",
    );
    expect(nodeToOffloadAddr({ hostname: "192.168.1.5" })).toBe("192.168.1.5:8092");
    expect(nodeToOffloadAddr({ hostname: "ws.local" })).toBe("ws.local:8092");
  });

  it("returns empty for a node with no host (auto-discover)", () => {
    expect(nodeToOffloadAddr({ hostname: "" })).toBe("");
    expect(nodeToOffloadAddr({ hostname: "   " })).toBe("");
  });
});
