/**
 * @module nodes/command-sink.test
 * @description The cloud command lane hands the queue row id to `onQueued` the
 * instant a command is accepted, so a surface can watch the vehicle's real
 * answer land — and it does so only on a genuine queue write, never on a failed
 * enqueue. The synchronous result still reports "queued", not a fabricated ack.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, afterEach } from "vitest";

import type { SkillProtocol } from "@/lib/skills/skill-protocol";

// No LAN agent resolves for the node under test, so the cloud lane is the one
// exercised here rather than the LAN transport.
vi.mock("@/lib/agent/resolve-agent", () => ({
  resolveLocalAgentForDrone: () => null,
}));

// A controllable direct-FC protocol resolver: null by default (no FC connected),
// set per test to a fake live protocol.
const { directFcHolder } = vi.hoisted(() => ({
  directFcHolder: { protocol: null as SkillProtocol | null },
}));
vi.mock("@/lib/nodes/direct-fc-protocol", () => ({
  resolveDirectFcProtocol: () => directFcHolder.protocol,
}));

import { resolveNodeCommandReach, resolveNodeCommandSink } from "../command-sink";
import type {
  CommandTargetNode,
  NodeQueuedCloudCommand,
} from "../command-sink";

/** A minimal live protocol whose nine command methods all resolve accepted. */
function fakeLiveProtocol() {
  const accepted = (message: string) => async () => ({
    success: true,
    resultCode: 0,
    message,
  });
  return {
    arm: vi.fn(accepted("armed")),
    disarm: vi.fn(accepted("disarmed")),
    setFlightMode: vi.fn(async () => ({
      success: true,
      resultCode: 0,
      message: "mode",
    })),
    returnToLaunch: vi.fn(accepted("rtl")),
    land: vi.fn(accepted("land")),
    takeoff: vi.fn(async () => ({
      success: true,
      resultCode: 0,
      message: "takeoff",
    })),
    killSwitch: vi.fn(accepted("kill")),
    pauseMission: vi.fn(accepted("pause")),
    resumeMission: vi.fn(accepted("resume")),
  };
}

afterEach(() => {
  directFcHolder.protocol = null;
});

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

describe("kill / pause / resume are carried, not refused", () => {
  it.each([
    ["killSwitch", "killSwitch"],
    ["pauseMission", "pauseMission"],
    ["resumeMission", "resumeMission"],
  ] as const)(
    "dispatches %s over the agent lane",
    async (method, cmd) => {
      const enqueue = vi.fn(async () => ({ commandId: "cmd-x" }));
      const sink = resolveNodeCommandSink(CLOUD_NODE, {
        enqueueCloudCommand: enqueue,
      });

      // The lane can carry it (mapped to a real agent command, not null).
      expect(sink?.supports(method)).toBe(true);

      const result = await sink![method]();
      // It reached the queue as the agent-native command name, not a refusal.
      expect(enqueue).toHaveBeenCalledOnce();
      expect(enqueue).toHaveBeenCalledWith({
        deviceId: "dev-1",
        command: "send_command",
        args: { cmd, args: [] },
      });
      expect(result.success).toBe(true);
      expect(result.message).not.toContain("no equivalent");
    },
  );
});

describe("direct-fc command sink", () => {
  const DIRECT_NODE: CommandTargetNode = { deviceId: "fc-1", isDirectFc: true };

  it("drives a connected direct FC through its own live protocol", async () => {
    const protocol = fakeLiveProtocol();
    directFcHolder.protocol = protocol;

    const reach = resolveNodeCommandReach(DIRECT_NODE, {});

    expect(reach.blockedReason).toBeUndefined();
    expect(reach.sink?.transport).toBe("direct-fc");
    // The vehicle answers directly, so its result is a real acknowledgement.
    expect(reach.sink?.reportsVehicleAck).toBe(true);
    // Every board command is carried through the live link, autonomous nav
    // included — the vehicle, not the lane, decides whether it takes it.
    expect(reach.sink?.supports("returnToLaunch")).toBe(true);

    const result = await reach.sink!.arm();
    expect(protocol.arm).toHaveBeenCalledOnce();
    expect(result.success).toBe(true);
  });

  it("falls back to the blocked state when the direct FC link is gone", () => {
    directFcHolder.protocol = null;

    const reach = resolveNodeCommandReach(DIRECT_NODE, {});
    expect(reach.sink).toBeNull();
    expect(reach.blockedReason).toBe("direct-fc");
  });
});

describe("relayed command sink", () => {
  const RELAYED_NODE: CommandTargetNode = {
    deviceId: "drone-1",
    isRelayed: true,
  };

  it("drives a relayed drone through RelayedMavlinkBridge's live session once it is up", async () => {
    const protocol = fakeLiveProtocol();
    directFcHolder.protocol = protocol;

    const reach = resolveNodeCommandReach(RELAYED_NODE, {});

    // Once RelayedMavlinkBridge has registered a live protocol under this
    // node's id in the drone manager, a relayed node is driven exactly like a
    // direct FC — the vehicle's own acknowledgement, not a queued relay
    // command — even though it holds neither LAN credentials nor a cloud row.
    expect(reach.blockedReason).toBeUndefined();
    expect(reach.sink?.transport).toBe("direct-fc");
    expect(reach.sink?.reportsVehicleAck).toBe(true);

    const result = await reach.sink!.arm();
    expect(protocol.arm).toHaveBeenCalledOnce();
    expect(result.success).toBe(true);
  });

  it("falls back to relay-only while no live session has connected yet", () => {
    directFcHolder.protocol = null;

    const reach = resolveNodeCommandReach(RELAYED_NODE, {});
    expect(reach.sink).toBeNull();
    expect(reach.blockedReason).toBe("relay-only");
  });
});
