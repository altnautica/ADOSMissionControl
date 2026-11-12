/**
 * The demo's LAN-paired drones must never point at an address a real device on
 * the operator's network could answer: their hosts are in-process `mock://`
 * addresses and their IPs are in the documentation range.
 *
 * @license GPL-3.0-only
 */
import { beforeEach, describe, expect, it } from "vitest";

import { DEMO_LAN_NODE_IDS } from "@/lib/demo/demo-ids";
import { seedDemoLanNodes } from "@/mock/demo-seed/fleet";
import { useLocalNodesStore } from "@/stores/local-nodes-store";

const PRIVATE = [/^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./];

function hostOf(url: string): string {
  return url.replace(/^[a-z]+:\/\//, "").replace(/[:/].*$/, "");
}

describe("demo LAN nodes", () => {
  beforeEach(() => {
    useLocalNodesStore.setState({ nodes: [] });
  });

  it("seeds no private-network address and no HTTP host", () => {
    seedDemoLanNodes(1_000);
    const seeded = useLocalNodesStore.getState().nodes.filter((n) => (DEMO_LAN_NODE_IDS as readonly string[]).includes(n.deviceId));
    expect(seeded).toHaveLength(DEMO_LAN_NODE_IDS.length);
    for (const n of seeded) {
      expect(n.hostname).toMatch(/^mock:\/\//);
      for (const addr of [hostOf(n.hostname), n.ipv4 ?? ""]) {
        for (const re of PRIVATE) expect(addr).not.toMatch(re);
      }
    }
  });
});
