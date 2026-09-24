/**
 * @license GPL-3.0-only
 *
 * The Perception tab streams detections from the agent of the node it is
 * rendered for; another node's attached connection is never used.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { render } from "@testing-library/react";

import messages from "../../../../locales/en.json";
import { DroneVisionTab } from "../DroneVisionTab";

const connectVisionDetections = vi.fn((_opts: unknown) => ({ close: vi.fn() }));
const attached = { nodeDeviceId: "dev-1" };

vi.mock("@/lib/agent/vision-detections-ws", () => ({
  connectVisionDetections: (opts: unknown) => connectVisionDetections(opts),
}));
vi.mock("@/stores/agent-connection-store", () => ({
  useAgentConnectionStore: (sel: (s: unknown) => unknown) =>
    sel({
      client: null,
      agentUrl: "http://192.168.1.50:8080",
      apiKey: "k",
      nodeDeviceId: attached.nodeDeviceId,
    }),
}));
vi.mock("@/stores/agent-capabilities-store", () => ({
  useAgentCapabilitiesStore: (sel: (s: unknown) => unknown) =>
    sel({ byDevice: { "dev-1": { visionAvailable: true } } }),
  selectDeviceCapabilities: (
    s: { byDevice: Record<string, unknown> },
    id: string | null,
  ) => (id ? (s.byDevice[id] ?? null) : null),
}));
vi.mock("@/components/vision/VisionSummaryCard", () => ({ VisionSummaryCard: () => null }));
vi.mock("@/components/vision/VisionModelCountTile", () => ({ VisionModelCountTile: () => null }));
vi.mock("@/components/vision/PerceptionUsageCard", () => ({ PerceptionUsageCard: () => null }));
vi.mock("@/components/vision/VisionPipelinesPanel", () => ({ VisionPipelinesPanel: () => null }));
vi.mock("@/components/vision/VisionInputsPanel", () => ({ VisionInputsPanel: () => null }));
vi.mock("@/components/vision/PerceptionTierCard", () => ({ PerceptionTierCard: () => null }));
vi.mock("@/components/vision/PerceptionSessionCard", () => ({ PerceptionSessionCard: () => null }));
vi.mock("@/components/vision/ModelPicker", () => ({ ModelPicker: () => null }));
vi.mock("@/components/vision/DetectionOverlay", () => ({ DetectionOverlay: () => null }));
vi.mock("@/components/flight/VideoCanvas", () => ({ VideoCanvas: () => null }));

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <DroneVisionTab droneId="node:dev-1" nodeDeviceId="dev-1" />
    </NextIntlClientProvider>,
  );
}

describe("DroneVisionTab · detection feed transport", () => {
  beforeEach(() => {
    connectVisionDetections.mockClear();
  });

  it("streams from the node's own attached agent", () => {
    attached.nodeDeviceId = "dev-1";
    renderTab();
    expect(connectVisionDetections).toHaveBeenCalledTimes(1);
  });

  it("does not stream another node's detections under this drone", () => {
    attached.nodeDeviceId = "dev-other";
    renderTab();
    expect(connectVisionDetections).not.toHaveBeenCalled();
  });
});
