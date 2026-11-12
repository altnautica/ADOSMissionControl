/**
 * @license GPL-3.0-only
 *
 * The Perception cards render one node's capability reading. With node A
 * attached (its reading in the top-level store fields) and node B's page open,
 * every card shows B's own slice, and "unknown" when B never described itself,
 * never A's tier, accelerator, engine summary or cameras.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { cleanup, render, screen } from "@testing-library/react";

import messages from "../../../../locales/en.json";
import { PerceptionTierCard } from "../PerceptionTierCard";
import { VisionSummaryCard } from "../VisionSummaryCard";
import { PerceptionSessionCard } from "../PerceptionSessionCard";
import { VisionPipelinesPanel } from "../VisionPipelinesPanel";
import { VisionInputsPanel } from "../VisionInputsPanel";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import type { AgentCapabilitySnapshot } from "@/stores/agent-capabilities/types";
import { useVisionDetectionsStore } from "@/stores/vision-detections-store";

const DRONE_B = "node:dev-b";
const v = messages.vision;

/** Node A's reading: an NPU node running a detector on a named camera. */
function nodeA(base: AgentCapabilitySnapshot): AgentCapabilitySnapshot {
  return {
    ...base,
    loaded: true,
    perceptionTier: "local",
    perceptionOffloadTarget: undefined,
    npuTops: 6,
    hasAccelerator: true,
    visionAvailable: true,
    visionSummary: { activeModel: "model-on-a", backend: "ort", detectionsPerSec: 4, fps: 15 },
    cameras: [{ name: "camera-on-a", type: "csi", resolution: "1280x720", streaming: true }],
  } as AgentCapabilitySnapshot;
}

let base: AgentCapabilitySnapshot;

function attachA(slices: Record<string, AgentCapabilitySnapshot>) {
  const a = nodeA(base);
  useAgentCapabilitiesStore.setState({
    ...a,
    focusedDeviceId: "dev-a",
    byDevice: { "dev-a": a, ...slices },
  });
}

function wrap(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  const { byDevice: _b, focusedDeviceId: _f, ...rest } = useAgentCapabilitiesStore.getState();
  base = rest as unknown as AgentCapabilitySnapshot;
  useVisionDetectionsStore.getState().clear();
});
afterEach(cleanup);

describe("Perception cards on node B while node A is attached", () => {
  it("execution card shows unknown, not node A's tier and accelerator", () => {
    attachA({});
    wrap(<PerceptionTierCard droneId={DRONE_B} nodeDeviceId="dev-b" />);
    expect(screen.getByText(v.tier_unknown)).toBeTruthy();
    expect(screen.getByText(v.acceleratorNotReported)).toBeTruthy();
    expect(screen.queryByText(v.tier_local)).toBeNull();
    expect(screen.queryByText(/6\.0 TOPS/)).toBeNull();
  });

  it("execution card shows node B's own reported tier", () => {
    attachA({ "dev-b": { ...base, perceptionTier: "offload", hasAccelerator: false } as AgentCapabilitySnapshot });
    wrap(<PerceptionTierCard droneId={DRONE_B} nodeDeviceId="dev-b" />);
    expect(screen.getByText(v.tier_offload)).toBeTruthy();
    expect(screen.getByText(v.acceleratorNone)).toBeTruthy();
  });

  it("engine card does not show node A's active model", () => {
    attachA({});
    wrap(<VisionSummaryCard droneId={DRONE_B} nodeDeviceId="dev-b" />);
    expect(screen.queryByText("model-on-a")).toBeNull();
    expect(screen.queryByText(v.engineIdle)).toBeNull();
    expect(screen.getByText(v.stateUnknownTitle)).toBeTruthy();
  });

  it("session card does not expect a session from node A's tier", () => {
    attachA({});
    wrap(<PerceptionSessionCard droneId={DRONE_B} nodeDeviceId="dev-b" />);
    expect(screen.getByTestId("perception-session-card").getAttribute("data-session-state")).toBe("closed");
  });

  it("pipelines panel does not stamp node A's tier on node B's rows", () => {
    attachA({});
    useVisionDetectionsStore.getState().setBatch(DRONE_B, {
      modelId: "person",
      cameraId: "uvc-0",
      frameId: 1,
      tsMs: Date.now(),
      frameWidth: 1280,
      frameHeight: 720,
      detections: [],
    });
    wrap(<VisionPipelinesPanel droneId={DRONE_B} nodeDeviceId="dev-b" />);
    expect(screen.getAllByTestId("vision-pipeline-row")).toHaveLength(1);
    expect(screen.queryByTestId("exec-target-badge")).toBeNull();
  });

  it("inputs panel does not list node A's cameras and says B's are not reported", () => {
    attachA({});
    wrap(<VisionInputsPanel droneId={DRONE_B} nodeDeviceId="dev-b" />);
    expect(screen.queryByText("camera-on-a")).toBeNull();
    expect(screen.queryByText(v.noInputs)).toBeNull();
    expect(screen.getByText(v.inputsNotReported)).toBeTruthy();
  });
});

describe("PerceptionTierCard on a CPU-tier node", () => {
  it("renders the CPU tier and its hint, never a raw message key", () => {
    useAgentCapabilitiesStore.setState({
      byDevice: { "dev-c": { ...base, perceptionTier: "cpu", hasAccelerator: false } as AgentCapabilitySnapshot },
    });
    const { container } = wrap(<PerceptionTierCard droneId="node:dev-c" nodeDeviceId="dev-c" />);
    expect(screen.getByText(v.tier_cpu)).toBeTruthy();
    expect(screen.getByText(v.tierHint_cpu)).toBeTruthy();
    expect(container.textContent).not.toMatch(/tierHint_/);
  });
});
