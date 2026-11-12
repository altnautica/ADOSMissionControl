/**
 * The agent reports `perceptionTier: "cpu"` when its detector runs on the
 * node's own CPU. The GCS keeps that tier, names it, and treats it as an
 * on-node session.
 */

import { describe, it, expect } from "vitest";
import en from "../../../../locales/en.json";
import { normalizeCapabilities } from "@/stores/agent-capabilities/normalizer";
import { executionTarget, perceptionSessionState, tierLabel } from "../perception-health";

describe("cpu perception tier", () => {
  it("survives normalisation instead of reading as unknown", () => {
    const caps = normalizeCapabilities({ perceptionTier: "cpu" });
    expect(caps.perceptionTier).toBe("cpu");
  });

  it("has an operator label", () => {
    expect(tierLabel("cpu", true)).toBe("CPU");
    expect(en.vision.tier_cpu).toMatch(/CPU/);
  });

  it("is an on-node session", () => {
    expect(executionTarget("cpu", null)).toEqual({ kind: "local" });
    expect(perceptionSessionState("idle", "cpu")).toBe("opening");
  });
});
