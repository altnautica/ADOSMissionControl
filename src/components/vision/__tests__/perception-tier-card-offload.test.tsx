/**
 * @license GPL-3.0-only
 *
 * A drone's perception offload is opened by the drone itself: its offload
 * reconciler reads the pinned workstation and hands the compute node a
 * streaming session with the drone's own camera feed. A job submitted from
 * the GCS carries no such session, so the compute node would run it on a
 * placeholder frame and report success. The tier card therefore sets the pin
 * and nothing else.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import type * as NodeConfigModule from "@/components/command/settings/use-node-config";
import type * as LocalNodesModule from "@/stores/local-nodes-store";

vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// The persisted nodes store needs browser storage this environment lacks; an
// in-memory store with the same shape stands in. The factory imports zustand
// itself because vi.mock factories run before the file's static imports.
vi.mock("@/stores/local-nodes-store", async (importOriginal) => {
  const actual = await importOriginal<typeof LocalNodesModule>();
  const { create } = await import("zustand");
  return { ...actual, useLocalNodesStore: create(() => ({ nodes: [] as LocalNode[] })) };
});

const nodeConfig = vi.hoisted(() => ({ readOnly: false }));
vi.mock("@/components/command/settings/use-node-config", async (importOriginal) => {
  const actual = await importOriginal<typeof NodeConfigModule>();
  return {
    ...actual,
    useNodeConfig: () => ({
      config: { perception: { offload: { compute_node_addr: "192.168.1.60:8092" } } },
      readOnly: nodeConfig.readOnly,
      setValue: vi.fn(async () => undefined),
    }),
  };
});

import { renderWithIntl } from "../../../../tests/helpers/intl-wrapper";
import { PerceptionTierCard } from "@/components/vision/PerceptionTierCard";
import { ComputeAgentClient } from "@/lib/agent/compute-client";
import { useLocalNodesStore, type LocalNode } from "@/stores/local-nodes-store";

const WORKSTATION = {
  deviceId: "ws-1",
  name: "Bench workstation",
  hostname: "http://192.168.1.60:8080",
  apiKey: "key",
  profile: "workstation",
} as LocalNode;

describe("PerceptionTierCard offload controls", () => {
  beforeEach(() => {
    nodeConfig.readOnly = false;
    useLocalNodesStore.setState({ nodes: [WORKSTATION] });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useLocalNodesStore.setState({ nodes: [] });
  });

  it("offers no control that submits a compute job from the GCS", async () => {
    const submit = vi.spyOn(ComputeAgentClient.prototype, "submitJob").mockResolvedValue(null);
    renderWithIntl(<PerceptionTierCard droneId="drone-1" nodeDeviceId="node-1" />);

    // The pinned workstation is shown.
    expect(screen.getByText("Bench workstation")).toBeTruthy();
    for (const button of screen.queryAllByRole("button")) fireEvent.click(button);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(submit).not.toHaveBeenCalled();
  });

  it("locks the pin on a read-only connection instead of faking a local choice", () => {
    nodeConfig.readOnly = true;
    renderWithIntl(<PerceptionTierCard droneId="drone-1" nodeDeviceId="node-1" />);
    const trigger = screen.getByText("Bench workstation").closest("button");
    expect(trigger?.disabled).toBe(true);
  });
});
