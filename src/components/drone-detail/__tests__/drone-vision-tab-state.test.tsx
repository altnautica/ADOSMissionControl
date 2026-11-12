/**
 * @license GPL-3.0-only
 *
 * Perception on a node whose capabilities are unknown says so instead of
 * claiming no engine runs, and its engine and usage cards read this node's
 * connection, never another node's.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { cleanup, render, screen } from "@testing-library/react";

import messages from "../../../../locales/en.json";
import { DroneVisionTab } from "../DroneVisionTab";

const state = {
  attachedDeviceId: "dev-1" as string | null,
  caps: {} as Record<string, unknown>,
};
const usageProps = vi.fn();
const countProps = vi.fn();

vi.mock("@/lib/agent/vision-detections-ws", () => ({
  connectVisionDetections: () => ({ close: vi.fn() }),
}));
vi.mock("@/stores/agent-connection-store", () => ({
  useAgentConnectionStore: (sel: (s: unknown) => unknown) =>
    sel({
      client: null,
      agentUrl: "http://192.168.1.50:8080",
      apiKey: "k",
      nodeDeviceId: state.attachedDeviceId,
    }),
}));
vi.mock("@/stores/agent-capabilities-store", () => ({
  useAgentCapabilitiesStore: (sel: (s: unknown) => unknown) => sel({ byDevice: state.caps }),
  selectDeviceCapabilities: (s: { byDevice: Record<string, unknown> }, id: string | null) =>
    id ? (s.byDevice[id] ?? null) : null,
}));
vi.mock("@/components/vision/VisionSummaryCard", () => ({ VisionSummaryCard: () => null }));
vi.mock("@/components/vision/VisionModelCountTile", () => ({
  VisionModelCountTile: (p: unknown) => {
    countProps(p);
    return null;
  },
}));
vi.mock("@/components/vision/PerceptionUsageCard", () => ({
  PerceptionUsageCard: (p: unknown) => {
    usageProps(p);
    return null;
  },
}));
vi.mock("@/components/vision/VisionPipelinesPanel", () => ({ VisionPipelinesPanel: () => null }));
vi.mock("@/components/vision/VisionInputsPanel", () => ({ VisionInputsPanel: () => null }));
vi.mock("@/components/vision/PerceptionTierCard", () => ({ PerceptionTierCard: () => null }));
vi.mock("@/components/vision/PerceptionSessionCard", () => ({ PerceptionSessionCard: () => null }));
vi.mock("@/components/vision/ModelPicker", () => ({ ModelPicker: () => null }));

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <DroneVisionTab droneId="node:dev-1" nodeDeviceId="dev-1" />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  usageProps.mockClear();
  countProps.mockClear();
});
afterEach(cleanup);

describe("DroneVisionTab engine state", () => {
  it("unknown capabilities read as unknown, not as no engine", () => {
    state.caps = {};
    renderTab();
    expect(screen.getByTestId("vision-unknown")).toBeTruthy();
    expect(screen.queryByTestId("vision-onboarding")).toBeNull();
  });

  it("a node that reports no engine gets the set-up banner", () => {
    state.caps = { "dev-1": { visionAvailable: false } };
    renderTab();
    expect(screen.getByTestId("vision-onboarding")).toBeTruthy();
    expect(screen.queryByTestId("vision-unknown")).toBeNull();
  });

  it("scopes the usage and model-count cards to this node's connection", () => {
    state.caps = { "dev-1": { visionAvailable: true } };
    state.attachedDeviceId = "dev-other";
    renderTab();
    expect(usageProps).toHaveBeenLastCalledWith(expect.objectContaining({ agent: null }));
    expect(countProps).toHaveBeenLastCalledWith(expect.objectContaining({ agent: null }));

    cleanup();
    state.attachedDeviceId = "dev-1";
    renderTab();
    expect(usageProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ agent: expect.objectContaining({ agentUrl: "http://192.168.1.50:8080" }) }),
    );
  });
});
