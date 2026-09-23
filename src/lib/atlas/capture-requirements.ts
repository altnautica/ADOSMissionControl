/**
 * @module atlas/capture-requirements
 * @description Pure gating logic for the Atlas capture "setup" surface. Turns a
 * drone's readiness snapshot plus the GCS's own knowledge of paired compute
 * nodes into (a) a requirements checklist and (b) whether "Start capture" is
 * allowed and, if not, why. Kept side-effect-free so it is unit-testable and so
 * both the World Model setup surface and any future surface compute the same
 * gate identically.
 *
 * Requirement (b), the compute node, is deliberately sourced from the GCS side
 * (paired nodes + a reachability poll) rather than the agent readiness — the
 * agent does not probe the compute node, so only the GCS knows if one is paired
 * and reachable (per the locked contract). In demo mode the compute requirement
 * is treated as satisfied (a simulated node) so the flow is exercisable offline;
 * the camera + service requirements read the (mock) readiness as-is.
 *
 * Before the first readiness poll answers, or when it fails, nothing is known
 * about the drone's cameras or capture service. Those rows then read as unknown
 * rather than asserting "no cameras" or "capture disabled", and Start stays
 * blocked.
 *
 * @license GPL-3.0-only
 */

import type { AtlasReadiness } from "@/lib/agent/atlas-control-client";

export type RequirementTone = "met" | "warning" | "unmet" | "unknown";
export type RequirementId = "cameras" | "compute" | "service";

export interface AtlasRequirement {
  id: RequirementId;
  /** Whether the requirement passes (drives the check icon). */
  met: boolean;
  /** Icon tone: met (green check), warning (amber), unmet (red). */
  tone: RequirementTone;
  /** i18n key (under the `atlas` namespace) for the requirement title. */
  labelKey: string;
  /** i18n key for the status / "what to do" detail line. */
  detailKey: string;
  /** Interpolation values for the detail key. */
  detailValues?: Record<string, string | number>;
}

export interface AtlasCaptureGate {
  requirements: AtlasRequirement[];
  /** Whether every hard requirement passes so "Start capture" is allowed. */
  canStart: boolean;
  /** i18n key for why Start is blocked, or null when it is allowed. */
  startBlockedKey: string | null;
}

export interface AtlasGateInputs {
  /** The drone's readiness, or null before the first poll. */
  readiness: AtlasReadiness | null;
  /** Whether a workstation / compute node is paired (from local-nodes-store). */
  computePaired: boolean;
  /** Whether that node's job API is currently reachable. */
  computeReachable: boolean;
  /** Demo mode — the compute requirement is simulated-satisfied. */
  demo: boolean;
}

/**
 * Compute the requirements checklist + the Start gate from a readiness snapshot
 * and the GCS's compute-node knowledge. Hard requirements for Start: cameras
 * present, capture service enabled + running, and a compute node paired (demo
 * satisfies the compute one). Compute reachability is surfaced as a warning but
 * does not block Start — keyframes still capture and reconstruction runs once the
 * node is reachable / on landing.
 */
export function computeCaptureGate(inputs: AtlasGateInputs): AtlasCaptureGate {
  const { readiness, computePaired, computeReachable, demo } = inputs;

  const camerasConfigured = readiness?.camerasConfigured ?? 0;
  const camerasMet = camerasConfigured > 0;
  const camerasReq: AtlasRequirement = readiness
    ? {
        id: "cameras",
        met: camerasMet,
        tone: camerasMet ? "met" : "unmet",
        labelKey: "capture.reqCameras",
        detailKey: camerasMet ? "capture.reqCamerasMet" : "capture.reqCamerasUnmet",
        detailValues: camerasMet ? { count: camerasConfigured } : undefined,
      }
    : {
        id: "cameras",
        met: false,
        tone: "unknown",
        labelKey: "capture.reqCameras",
        detailKey: "capture.reqReadinessUnknown",
      };

  let computeReq: AtlasRequirement;
  if (demo) {
    computeReq = {
      id: "compute",
      met: true,
      tone: "met",
      labelKey: "capture.reqCompute",
      detailKey: "capture.reqComputeDemo",
    };
  } else if (!computePaired) {
    computeReq = {
      id: "compute",
      met: false,
      tone: "unmet",
      labelKey: "capture.reqCompute",
      detailKey: "capture.reqComputeUnmet",
    };
  } else if (!computeReachable) {
    computeReq = {
      id: "compute",
      met: false,
      tone: "warning",
      labelKey: "capture.reqCompute",
      detailKey: "capture.reqComputeUnreachable",
    };
  } else {
    computeReq = {
      id: "compute",
      met: true,
      tone: "met",
      labelKey: "capture.reqCompute",
      detailKey: "capture.reqComputeMet",
    };
  }

  const serviceMet = Boolean(readiness?.enabled && readiness?.serviceRunning);
  let serviceDetail: string;
  if (!readiness) {
    serviceDetail = "capture.reqReadinessUnknown";
  } else if (serviceMet) {
    serviceDetail = "capture.reqServiceMet";
  } else if (!readiness.enabled) {
    serviceDetail = "capture.reqServiceDisabled";
  } else {
    serviceDetail = "capture.reqServiceStopped";
  }
  const serviceReq: AtlasRequirement = {
    id: "service",
    met: serviceMet,
    tone: !readiness ? "unknown" : serviceMet ? "met" : "unmet",
    labelKey: "capture.reqService",
    detailKey: serviceDetail,
  };

  // Start is allowed once cameras + service pass and a compute node is paired
  // (demo satisfies the compute gate). Reachability is a warning, not a blocker.
  const computeSatisfiedForStart = demo || computePaired;
  const canStart = camerasMet && serviceMet && computeSatisfiedForStart;

  let startBlockedKey: string | null = null;
  if (!canStart) {
    if (!readiness) startBlockedKey = "capture.startBlockedReadinessUnknown";
    else if (!camerasMet) startBlockedKey = "capture.startBlockedCameras";
    else if (!serviceMet) startBlockedKey = "capture.startBlockedService";
    else startBlockedKey = "capture.startBlockedCompute";
  }

  return {
    requirements: [camerasReq, computeReq, serviceReq],
    canStart,
    startBlockedKey,
  };
}
