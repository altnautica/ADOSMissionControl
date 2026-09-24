import { describe, expect, it } from "vitest";

import {
  agentRedirect,
  topLevelAlias,
} from "@/components/dashboard/node-detail/agent/agent-redirect";

// The drone's top-level surfaces after the Agent-page consolidation.
const DRONE_IDS = [
  "overview",
  "flight",
  "cockpit",
  "configure",
  "parameters",
  "logs",
  "agent",
];
// A ground station keeps its own top-level Radio tab.
const GS_IDS = ["overview", "radio", "network", "mesh", "display", "logs", "agent"];

describe("agentRedirect", () => {
  it("redirects a persisted companion tab id to its Agent sub-page", () => {
    // The retired Settings tab has no host page left — the config pages sit in
    // the Agent sidebar directly, so it lands on the first of them.
    expect(agentRedirect("settings", DRONE_IDS)).toBe("profile");
    expect(agentRedirect("system", DRONE_IDS)).toBe("system");
    expect(agentRedirect("plugins", DRONE_IDS)).toBe("plugins");
    expect(agentRedirect("vision", DRONE_IDS)).toBe("vision");
  });

  it("maps the retired air-side Link id to the Agent sub-page for a drone", () => {
    expect(agentRedirect("radio", DRONE_IDS)).toBe("radio");
  });

  it("leaves Logs at top level — it is a surface on every profile now", () => {
    expect(agentRedirect("logs", DRONE_IDS)).toBeNull();
    expect(topLevelAlias("logs", DRONE_IDS)).toBe("logs");
  });
});

describe("topLevelAlias", () => {
  it("maps legacy Flights / Black Box ids to the Logs surface", () => {
    expect(topLevelAlias("flights", DRONE_IDS)).toBe("logs");
    expect(topLevelAlias("blackbox", DRONE_IDS)).toBe("logs");
  });

  it("maps the retired Distributed RX tab to the merged Mesh & RX surface", () => {
    expect(topLevelAlias("distributedRx", GS_IDS)).toBe("mesh");
  });

  it("never rewrites an id the profile still owns", () => {
    // A hypothetical profile that kept `flights` at top level keeps its meaning.
    expect(topLevelAlias("flights", ["flights", "agent"])).toBe("flights");
  });

  it("leaves an id with no alias, or whose alias this profile lacks, alone", () => {
    expect(topLevelAlias("does-not-exist", DRONE_IDS)).toBe("does-not-exist");
    expect(topLevelAlias("distributedRx", DRONE_IDS)).toBe("distributedRx");
  });

  it("never captures an id a profile still owns at top level (GS Radio)", () => {
    expect(agentRedirect("radio", GS_IDS)).toBeNull();
  });

  it("leaves a real top-level tab untouched", () => {
    expect(agentRedirect("overview", DRONE_IDS)).toBeNull();
    expect(agentRedirect("agent", DRONE_IDS)).toBeNull();
    expect(agentRedirect("parameters", DRONE_IDS)).toBeNull();
  });

  it("returns null for an unknown id", () => {
    expect(agentRedirect("does-not-exist", DRONE_IDS)).toBeNull();
  });
});
