/**
 * Tests for the `vision.designate` branch of the plugin `command.send` handler:
 * a plugin overlay's click-to-follow routes to the LAN agent's designate route
 * (locking the engine tracker), bypassing the FC command allowlist. The agent
 * `VisionAgentClient` and `local-nodes-store` are mocked.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { designate } = vi.hoisted(() => ({ designate: vi.fn() }));
vi.mock("@/lib/agent/vision-client", () => ({
  VisionAgentClient: class {
    constructor(_baseUrl: string, _apiKey: string) {}
    designate = designate;
  },
}));

let nodes: Array<{ deviceId: string; hostname: string; apiKey: string }> = [];
vi.mock("@/stores/local-nodes-store", () => ({
  useLocalNodesStore: { getState: () => ({ nodes }) },
}));

import { buildControlHandlers } from "../control";
import type { BridgeHandlerContext } from "@/lib/plugins/bridge";
import type { PluginTarget } from "../target";
import { setPluginConfirmHandler } from "@/lib/plugins/confirm";
import { resetCommandRateLimits } from "../command-rate";

const BBOX = { x: 10, y: 20, width: 30, height: 40 };
const NODE = { deviceId: "d1", hostname: "http://drone.local:8080", apiKey: "k" };
const TARGET: PluginTarget = { nodeId: "node:d1", deviceId: "d1" };

function callDesignate(
  args: Record<string, unknown>,
  target: PluginTarget | null = TARGET,
) {
  const handlers = buildControlHandlers("com.altnautica.follow-me", target);
  return handlers["command.send"](
    { command: "vision.designate", args },
    {} as BridgeHandlerContext,
  );
}

describe("command.send vision.designate branch", () => {
  beforeEach(() => {
    designate.mockReset();
    designate.mockResolvedValue({ designated: true, trackId: 7 });
    nodes = [];
    resetCommandRateLimits();
    // Every designation needs the operator's approval; approve by default.
    setPluginConfirmHandler(async () => true);
  });

  it("does not retarget the tracker when the operator declines", async () => {
    nodes = [NODE];
    setPluginConfirmHandler(async () => false);
    const res = await callDesignate({ camera_id: "uvc-0", bbox: BBOX });
    expect(res).toMatchObject({ ok: false, error: "operator denied" });
    expect(designate).not.toHaveBeenCalled();
  });

  it("designates via the LAN agent and returns the locked track", async () => {
    nodes = [NODE];
    const res = await callDesignate({
      camera_id: "uvc-0",
      bbox: BBOX,
      class_label: "person",
      confidence: 0.9,
    });
    expect(designate).toHaveBeenCalledWith("uvc-0", BBOX, {
      classLabel: "person",
      confidence: 0.9,
    });
    expect(res).toMatchObject({ ok: true, result: { designated: true, trackId: 7 } });
  });

  it("returns an honest error when the drone has no LAN seam", async () => {
    const res = await callDesignate({ camera_id: "uvc-0", bbox: BBOX });
    expect(res).toMatchObject({ ok: false });
    expect(designate).not.toHaveBeenCalled();
  });

  it("rejects a malformed bbox before reaching the agent", async () => {
    nodes = [NODE];
    const res = await callDesignate({ camera_id: "uvc-0", bbox: { x: 1 } });
    expect(res).toMatchObject({ ok: false });
    expect(designate).not.toHaveBeenCalled();
  });

  it("rejects when the plugin has no scoped drone", async () => {
    const res = await callDesignate({ camera_id: "uvc-0", bbox: BBOX }, null);
    expect(res).toMatchObject({
      ok: false,
      error: expect.stringContaining("scoped drone"),
    });
  });
});
