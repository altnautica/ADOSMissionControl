import { describe, expect, it, vi } from "vitest";

import { AgentClient, agentSupports } from "@/lib/agent/client";
import type { AgentVersionInfo } from "@/lib/agent/types";

/**
 * Cross-repo contract test for /api/version capability negotiation.
 *
 * The agent has the mirror test at:
 *   ADOSDroneAgent/crates/ados-control/src/routes/system.rs
 *   (served_capabilities_match_the_gcs_contract)
 *
 * Both AGENT_CAPABILITIES_FROZEN lists must stay in lockstep, in order.
 * When a flag is added to CAPABILITIES in that file, update BOTH:
 *   1. AGENT_CAPABILITIES_FROZEN here
 *   2. AGENT_CAPABILITIES_FROZEN in the agent test
 *
 * The two-sided lock catches a prior seam regression where
 * /api/status/full landed without GCS knowing whether the agent
 * supported it. If the lists drift, one side's test fails with a
 * clear "GCS contract drift" / "agent contract drift" message.
 */

const AGENT_CAPABILITIES_FROZEN: readonly string[] = [
  "status.full",
  "version.endpoint",
  "services.control",
  "video.pipeline",
  "wfb.link",
  // Retired: the scripting service was removed, but the agent keeps advertising
  // this flag per its append-only capability contract (a shipped flag is never
  // removed). The GCS no longer acts on it; it stays here to hold lockstep.
  "scripts.runtime",
  "pairing.mnemonic",
  "pairing.bind_state",
  "peripherals.registry",
  "fleet.roster",
  "features.catalog",
  "ground_station.profile",
  "signing.mavlink",
  "webrtc.signaling.last_error",
  "battery.health",
];

describe("agent /api/version contract", () => {
  it("AgentClient parses the canonical response shape", async () => {
    const fixture: AgentVersionInfo = {
      api_version: "1",
      agent_version: "0.8.10",
      capabilities: [...AGENT_CAPABILITIES_FROZEN],
    };
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(fixture), { status: 200 }),
    );
    const client = new AgentClient(`http://contract-${Date.now()}.local`);
    const info = await client.getVersion();
    expect(info).toEqual(fixture);
  });

  it("agentSupports recognizes every frozen capability", () => {
    const info: AgentVersionInfo = {
      api_version: "1",
      agent_version: "0.8.10",
      capabilities: [...AGENT_CAPABILITIES_FROZEN],
    };
    for (const cap of AGENT_CAPABILITIES_FROZEN) {
      expect(agentSupports(info, cap)).toBe(true);
    }
    // Unknown flags must NOT be reported as supported.
    expect(agentSupports(info, "definitely.not.real")).toBe(false);
  });

  it("frozen contract has no duplicates", () => {
    const seen = new Set<string>();
    for (const cap of AGENT_CAPABILITIES_FROZEN) {
      expect(seen.has(cap)).toBe(false);
      seen.add(cap);
    }
  });

  it("frozen contract uses dot-namespaced flags", () => {
    for (const cap of AGENT_CAPABILITIES_FROZEN) {
      expect(cap).toMatch(/^[a-z][a-z_]*\.[a-z_.]+$/);
    }
  });

  it("getFullStatus skips when status.full is absent (older agent)", async () => {
    const fixture: AgentVersionInfo = {
      api_version: "1",
      agent_version: "0.7.0",
      capabilities: AGENT_CAPABILITIES_FROZEN.filter((c) => c !== "status.full"),
    };
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/api/version")) {
        return new Response(JSON.stringify(fixture), { status: 200 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    const client = new AgentClient(`http://contract-skip-${Date.now()}.local`);
    const result = await client.getFullStatus();
    expect(result).toBeNull();
  });
});
