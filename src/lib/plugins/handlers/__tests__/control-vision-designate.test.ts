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

// The drone's FC session and registry entry, keyed by the node id.
const { sendCommand } = vi.hoisted(() => ({ sendCommand: vi.fn(async () => ({ success: true })) }));
vi.mock("@/stores/drone-manager", () => ({
  useDroneManager: {
    getState: () => ({ drones: new Map([["node:d1", { protocol: { sendCommand } }]]) }),
  },
}));
vi.mock("@/stores/node-registry", () => ({
  useNodeRegistryStore: {
    getState: () => ({
      getEntry: (id: string) =>
        id === "node:d1" ? { fc: { armState: "disarmed" }, connection: { fcConnected: true } } : undefined,
    }),
  },
}));

import { buildControlHandlers } from "../control";
import { buildPluginHandlers } from "../index";
import { resolveRequiredCapability } from "@/lib/plugins/methods";
import { COMMAND_RATE_LIMIT_MAX } from "../command-rate";
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

  it("needs its own capability, not the generic command grant", () => {
    expect(resolveRequiredCapability("command.send", { command: "vision.designate" })).toBe(
      "vision.track.designate",
    );
    expect(resolveRequiredCapability("command.send", { command: "rtl" })).toBe("command.send");
  });

  it("rate-limits designations like vehicle commands", async () => {
    nodes = [NODE];
    for (let i = 0; i < COMMAND_RATE_LIMIT_MAX; i++) {
      await callDesignate({ camera_id: "uvc-0", bbox: BBOX });
    }
    const res = await callDesignate({ camera_id: "uvc-0", bbox: BBOX });
    expect(res).toMatchObject({ ok: false, error: "command rate limit exceeded" });
    expect(designate).toHaveBeenCalledTimes(COMMAND_RATE_LIMIT_MAX);
  });

  it("reaches the same drone for a vehicle command and a designation from one node id", async () => {
    nodes = [NODE];
    sendCommand.mockClear();
    const { handlers } = buildPluginHandlers("com.altnautica.follow-me", "node:d1", {
      translate: (k: string) => k,
    });
    const ctx = { claims: { agentId: "d1" } } as unknown as BridgeHandlerContext;
    const land = await handlers["command.send"]({ command: "land" }, ctx);
    const follow = await handlers["command.send"](
      { command: "vision.designate", args: { camera_id: "uvc-0", bbox: BBOX } },
      ctx,
    );
    expect(land).toMatchObject({ ok: true });
    expect(sendCommand).toHaveBeenCalledTimes(1);
    expect(follow).toMatchObject({ ok: true });
    expect(designate).toHaveBeenCalledTimes(1);
  });
});
