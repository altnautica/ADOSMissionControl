/**
 * Tests for the Atlas capture-gate logic (`computeCaptureGate`): the
 * requirements checklist tones and the Start gate + its blocked reason. This is
 * the pure "tab / setup surface" gating that decides whether Start capture is
 * allowed and what the requirements rows report.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import { computeCaptureGate } from "@/lib/atlas/capture-requirements";
import type { AtlasReadiness } from "@/lib/agent/atlas-control-client";

function readiness(overrides: Partial<AtlasReadiness>): AtlasReadiness {
  return {
    enabled: true,
    profile: "drone",
    captureProfile: "balanced",
    reconstructSteps: 30000,
    camerasConfigured: 6,
    poseSource: "local_vio",
    serviceRunning: true,
    capturing: false,
    state: "idle",
    sessionId: null,
    cameraCount: 6,
    keyframes: 0,
    ingestRateHz: 0,
    ...overrides,
  };
}

function req(gate: ReturnType<typeof computeCaptureGate>, id: string) {
  return gate.requirements.find((r) => r.id === id)!;
}

describe("computeCaptureGate", () => {
  it("all requirements met -> canStart, no blocked reason", () => {
    const gate = computeCaptureGate({
      readiness: readiness({}),
      computePaired: true,
      computeReachable: true,
      demo: false,
    });
    expect(req(gate, "cameras").tone).toBe("met");
    expect(req(gate, "compute").tone).toBe("met");
    expect(req(gate, "service").tone).toBe("met");
    expect(gate.canStart).toBe(true);
    expect(gate.startBlockedKey).toBeNull();
  });

  it("no readiness yet -> cameras and service unknown, not asserted absent", () => {
    const gate = computeCaptureGate({
      readiness: null,
      computePaired: false,
      computeReachable: false,
      demo: false,
    });
    expect(req(gate, "cameras").tone).toBe("unknown");
    expect(req(gate, "cameras").detailKey).toBe("capture.reqReadinessUnknown");
    expect(req(gate, "compute").tone).toBe("unmet");
    expect(req(gate, "service").tone).toBe("unknown");
    expect(req(gate, "service").detailKey).toBe("capture.reqReadinessUnknown");
    expect(gate.canStart).toBe(false);
    expect(gate.startBlockedKey).toBe("capture.startBlockedReadinessUnknown");
  });

  it("compute paired but unreachable -> warning tone, still can start", () => {
    const gate = computeCaptureGate({
      readiness: readiness({}),
      computePaired: true,
      computeReachable: false,
      demo: false,
    });
    const compute = req(gate, "compute");
    expect(compute.tone).toBe("warning");
    expect(compute.met).toBe(false);
    // Reachability is a warning, not a Start blocker.
    expect(gate.canStart).toBe(true);
    expect(gate.startBlockedKey).toBeNull();
  });

  it("cameras + service ok but no node paired -> blocked on compute", () => {
    const gate = computeCaptureGate({
      readiness: readiness({}),
      computePaired: false,
      computeReachable: false,
      demo: false,
    });
    expect(req(gate, "compute").tone).toBe("unmet");
    expect(gate.canStart).toBe(false);
    expect(gate.startBlockedKey).toBe("capture.startBlockedCompute");
  });

  it("service not enabled -> blocked on service with the enable hint", () => {
    const gate = computeCaptureGate({
      readiness: readiness({ enabled: false, serviceRunning: false }),
      computePaired: true,
      computeReachable: true,
      demo: false,
    });
    const service = req(gate, "service");
    expect(service.met).toBe(false);
    expect(service.detailKey).toBe("capture.reqServiceDisabled");
    expect(gate.startBlockedKey).toBe("capture.startBlockedService");
  });

  it("enabled but service stopped -> stopped detail, still blocked", () => {
    const gate = computeCaptureGate({
      readiness: readiness({ enabled: true, serviceRunning: false }),
      computePaired: true,
      computeReachable: true,
      demo: false,
    });
    expect(req(gate, "service").detailKey).toBe("capture.reqServiceStopped");
    expect(gate.canStart).toBe(false);
  });

  it("demo satisfies the compute requirement (simulated node)", () => {
    const gate = computeCaptureGate({
      readiness: readiness({}),
      computePaired: false,
      computeReachable: false,
      demo: true,
    });
    const compute = req(gate, "compute");
    expect(compute.tone).toBe("met");
    expect(compute.detailKey).toBe("capture.reqComputeDemo");
    expect(gate.canStart).toBe(true);
  });

  it("cameras row carries the configured count for interpolation", () => {
    const gate = computeCaptureGate({
      readiness: readiness({ camerasConfigured: 3 }),
      computePaired: true,
      computeReachable: true,
      demo: false,
    });
    expect(req(gate, "cameras").detailValues).toEqual({ count: 3 });
  });
});
