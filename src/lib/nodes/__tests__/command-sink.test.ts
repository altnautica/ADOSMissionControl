/**
 * @module nodes/command-sink.test
 * @description The cloud command lane hands the queue row id to `onQueued` the
 * instant a command is accepted, so a surface can watch the vehicle's real
 * answer land — and it does so only on a genuine queue write, never on a failed
 * enqueue. The synchronous result still reports "queued", not a fabricated ack.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi } from "vitest";

// No LAN agent resolves for the node under test, so the cloud lane is the one
// exercised here rather than the LAN transport.
vi.mock("@/lib/agent/resolve-agent", () => ({
  resolveLocalAgentForDrone: () => null,
}));

import { resolveNodeCommandReach } from "../command-sink";
import type {
  CommandTargetNode,
  NodeQueuedCloudCommand,
} from "../command-sink";

const CLOUD_NODE: CommandTargetNode = { deviceId: "dev-1", convexId: "cx-1" };

describe("cloud command sink onQueued", () => {
  it("hands the queue row id to onQueued on a successful enqueue", async () => {
    const queued: NodeQueuedCloudCommand[] = [];
    const enqueue = vi.fn(async () => ({ commandId: "cmd-42" }));

    const reach = resolveNodeCommandReach(CLOUD_NODE, {
      enqueueCloudCommand: enqueue,
      onQueued: (q) => queued.push(q),
    });

    expect(reach.sink?.transport).toBe("cloud");
    const result = await reach.sink!.arm();

    expect(enqueue).toHaveBeenCalledOnce();
    expect(queued).toEqual([{ deviceId: "dev-1", commandId: "cmd-42" }]);
    // The synchronous answer is still only "queued" — never a fabricated ack.
    expect(result.success).toBe(true);
    expect(result.message).toContain("cmd-42");
  });

  it("does not call onQueued when the enqueue itself fails", async () => {
    const onQueued = vi.fn();
    const enqueue = vi.fn(async () => {
      throw new Error("relay unreachable");
    });

    const reach = resolveNodeCommandReach(CLOUD_NODE, {
      enqueueCloudCommand: enqueue,
      onQueued,
    });

    const result = await reach.sink!.arm();
    expect(result.success).toBe(false);
    expect(onQueued).not.toHaveBeenCalled();
  });
});
