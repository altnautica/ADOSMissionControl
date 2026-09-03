/**
 * @module nodes/command-sink.test
 * @description What each command lane may claim about a command it carried.
 * The cloud lane hands the queue row id to `onQueued` the instant a command is
 * accepted, so a surface can watch the vehicle's real answer land — and it does
 * so only on a genuine queue write, never on a failed enqueue. Its synchronous
 * result still reports "queued", not a fabricated ack.
 *
 * A relayed drone is commanded through its ground station's relay-proxy route,
 * so the lane has to address the ground station (not the drone, which has no
 * address here) and name the right cause when it cannot resolve: an unpaired
 * ground station and an HTTPS page origin are different faults with different
 * fixes, and reporting one as the other sends the operator after the wrong one.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, afterEach } from "vitest";

import type * as AgentSystem from "@/lib/agent/agent-client/system";
import type { SkillProtocol } from "@/lib/skills/skill-protocol";

// LAN credentials resolve per device id and default to none, so the cloud cases
// exercise the cloud lane. A relayed drone's ground station is paired per test;
// the drone itself never resolves one — it holds no LAN address of its own.
const { lanHolder } = vi.hoisted(() => ({
  lanHolder: {
    agents: {} as Record<string, { agentUrl: string; apiKey: string }>,
  },
}));
vi.mock("@/lib/agent/resolve-agent", () => ({
  resolveLocalAgentForDrone: (deviceId: string) =>
    lanHolder.agents[deviceId] ?? null,
}));

// The LAN and relay-proxy lanes both terminate at the agent's command route, so
// stubbing that route is what lets a test assert WHERE a command was addressed
// and with whose key, rather than only that something was dispatched.
const { runCommandMock } = vi.hoisted(() => ({
  runCommandMock: vi.fn(async () => ({
    accepted: true,
    resultCode: 0,
    message: "Accepted",
  })),
}));
vi.mock("@/lib/agent/agent-client/system", async (importOriginal) => ({
  ...(await importOriginal<typeof AgentSystem>()),
  runCommand: runCommandMock,
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
  lanHolder.agents = {};
  runCommandMock.mockClear();
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

      // killSwitch now takes the operator confirmation the dispatcher already
      // collected; pause/resume take nothing. Calling each with `true` is
      // harmless for the no-arg ones and is what the kill lane requires.
      const result = await sink![method](true);
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
  const GROUND_DEVICE_ID = "ground-7";
  const GROUND_AGENT = {
    agentUrl: "http://192.168.1.50:8080",
    apiKey: "gs-key",
  };
  /** The relay-proxy prefix the ground station exposes for this drone. */
  const RELAY_BASE_URL =
    "http://192.168.1.50:8080/api/v1/ground-station/relay-proxy/drone-1";

  const RELAYED_NODE: CommandTargetNode = {
    deviceId: "drone-1",
    isRelayed: true,
    reachedVia: `node:${GROUND_DEVICE_ID}`,
  };

  /** LAN-pair the ground station this drone is relayed through — and only it. */
  function pairGroundStation() {
    lanHolder.agents[GROUND_DEVICE_ID] = GROUND_AGENT;
  }

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

  it("commands a relayed drone over its ground station's relay-proxy route", async () => {
    pairGroundStation();

    const reach = resolveNodeCommandReach(RELAYED_NODE, {
      originIsHttps: false,
    });

    expect(reach.blockedReason).toBeUndefined();
    expect(reach.sink?.transport).toBe("relay-proxy");
    // The proxy projects the drone's own HTTP status back, so the result is the
    // vehicle's answer rather than a receipt for something queued.
    expect(reach.sink?.reportsVehicleAck).toBe(true);

    const result = await reach.sink!.arm();

    // Addressed to the ground station's relay-proxy prefix for THIS peer, with
    // the ground station's key — never to the drone, which has no address here.
    // `relay: true` rides along so the request context cannot misdescribe its
    // own transport: nothing reads it on this path today, but a context that
    // says "LAN" about a radio hop is a bug waiting for the first reader.
    expect(runCommandMock).toHaveBeenCalledOnce();
    expect(runCommandMock).toHaveBeenCalledWith(
      { baseUrl: RELAY_BASE_URL, apiKey: "gs-key", relay: true },
      "arm",
      [],
    );
    expect(result.success).toBe(true);
    expect(result.resultCode).toBe(0);
  });

  it("keeps the live MAVLink session ahead of the relay-proxy lane", async () => {
    // Both lanes are available. The vehicle's own protocol wins, because only
    // it answers with the vehicle's ack instead of the agent's HTTP status.
    pairGroundStation();
    directFcHolder.protocol = fakeLiveProtocol();

    const reach = resolveNodeCommandReach(RELAYED_NODE, {
      originIsHttps: false,
    });

    expect(reach.sink?.transport).toBe("direct-fc");
    await reach.sink!.arm();
    expect(runCommandMock).not.toHaveBeenCalled();
  });

  it("names the HTTPS block, not a missing pairing, when the origin blocks the lane", () => {
    pairGroundStation();

    const reach = resolveNodeCommandReach(RELAYED_NODE, {
      originIsHttps: true,
    });

    // The ground station IS paired here; the page origin is what stops the
    // plain-HTTP hop to it. "relay-only" would name a cause that is not true.
    expect(reach.sink).toBeNull();
    expect(reach.blockedReason).toBe("lan-blocked-by-https");
  });

  it("falls back to relay-only when the ground station is not paired here", () => {
    // No LAN agent resolves for anyone, so the radio has a far end this browser
    // can see and no near end it can address.
    const reach = resolveNodeCommandReach(RELAYED_NODE, {
      originIsHttps: false,
    });

    expect(reach.sink).toBeNull();
    expect(reach.blockedReason).toBe("relay-only");
  });

  it("falls back to relay-only when the node names no ground station", () => {
    // The ground station is paired, but nothing links this drone to it, so
    // there is no peer id to route a relay-proxy call through.
    pairGroundStation();

    const reach = resolveNodeCommandReach(
      { deviceId: "drone-1", isRelayed: true },
      { originIsHttps: false },
    );

    expect(reach.sink).toBeNull();
    expect(reach.blockedReason).toBe("relay-only");
  });
});
