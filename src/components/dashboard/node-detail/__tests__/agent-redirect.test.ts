import { describe, expect, it } from "vitest";

import { agentRedirect } from "@/components/dashboard/node-detail/agent/agent-redirect";

// The drone's top-level surfaces after the Agent-page consolidation.
const DRONE_IDS = [
  "overview",
  "flight",
  "cockpit",
  "configure",
  "parameters",
  "agent",
];
// A ground station keeps its own top-level Radio tab.
const GS_IDS = ["overview", "radio", "network", "display", "agent"];

describe("agentRedirect", () => {
  it("redirects a persisted companion tab id to its Agent sub-page", () => {
    // The retired Settings tab has no host page left — the config pages sit in
    // the Agent sidebar directly, so it lands on the first of them.
    expect(agentRedirect("settings", DRONE_IDS)).toBe("profile");
    expect(agentRedirect("system", DRONE_IDS)).toBe("system");
    expect(agentRedirect("plugins", DRONE_IDS)).toBe("plugins");
    expect(agentRedirect("logs", DRONE_IDS)).toBe("logs");
    expect(agentRedirect("vision", DRONE_IDS)).toBe("vision");
    expect(agentRedirect("world-model", DRONE_IDS)).toBe("world-model");
  });

  it("maps the retired air-side Link id to the Agent sub-page for a drone", () => {
    expect(agentRedirect("radio", DRONE_IDS)).toBe("radio");
  });

  it("maps legacy Flights / Black Box ids to the Logs sub-page", () => {
    expect(agentRedirect("flights", DRONE_IDS)).toBe("logs");
    expect(agentRedirect("blackbox", DRONE_IDS)).toBe("logs");
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
