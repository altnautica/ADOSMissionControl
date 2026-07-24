/**
 * @license GPL-3.0-only
 *
 * Downstream half of the LAN-pair SSRF guard: `normaliseAndCheckHost` admits a
 * single DNS-resolvable host (a `.local` mDNS name), so the server-side resolver
 * must refuse a name that (through a poisoned resolver, DNS rebinding) resolves
 * to a PUBLIC address before the proxy fetches it with the operator's key.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { lookup } = vi.hoisted(() => ({ lookup: vi.fn() }));

vi.mock("node:dns", () => ({
  default: { promises: { lookup } },
  promises: { lookup },
}));

import { resolveIpv4 } from "../_ipv4";

beforeEach(() => {
  lookup.mockReset();
});

describe("resolveIpv4 — DNS-rebinding guard", () => {
  it("returns a private resolved address", async () => {
    lookup.mockResolvedValue({ address: "192.168.1.42", family: 4 });
    await expect(resolveIpv4("agent-node.local")).resolves.toBe("192.168.1.42");
  });

  it("refuses a name that resolves to a public address", async () => {
    lookup.mockResolvedValue({ address: "8.8.8.8", family: 4 });
    await expect(resolveIpv4("rebind.attacker.example")).resolves.toBeNull();
  });

  it("returns a dotted-quad literal unchanged without a lookup", async () => {
    await expect(resolveIpv4("10.0.0.5")).resolves.toBe("10.0.0.5");
    expect(lookup).not.toHaveBeenCalled();
  });

  it("returns null on lookup failure", async () => {
    lookup.mockRejectedValue(new Error("ENOTFOUND"));
    await expect(resolveIpv4("missing.local")).resolves.toBeNull();
  });
});
