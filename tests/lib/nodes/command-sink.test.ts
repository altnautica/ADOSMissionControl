/**
 * Tests for the per-node command sink: which transport carries a command to a
 * given node, what each transport actually reports back, and what happens to a
 * command the transport has no equivalent for.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// local-nodes-store is persisted; bind an in-memory localStorage before import.
vi.hoisted(() => {
  const mem = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: {
      getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
      clear: () => mem.clear(),
      key: () => null,
      get length() {
        return mem.size;
      },
    },
  });
});

import type { ReactMutation } from "convex/react";
import {
  resolveNodeCommandReach,
  resolveNodeCommandSink,
  type CloudCommandEnqueuer,
  type CommandTargetNode,
} from "@/lib/nodes/command-sink";
import { useLocalNodesStore, type LocalNode } from "@/stores/local-nodes-store";
import { api } from "../../../convex/_generated/api";

/**
 * Compile-time proof that the cloud queue mutation satisfies the enqueuer the
 * sink asks for, so a caller can hand its mutation straight in.
 */
const _enqueuerAcceptsTheQueueMutation: CloudCommandEnqueuer =
  null as unknown as ReactMutation<typeof api.cmdDroneCommands.enqueueCommand>;
void _enqueuerAcceptsTheQueueMutation;

const DEVICE_ID = "device-alpha";

const NODE: CommandTargetNode = { deviceId: DEVICE_ID, convexId: "row-alpha" };

function lanNode(deviceId: string): LocalNode {
  return {
    deviceId,
    name: "Alpha",
    hostname: "http://alpha.example:8080",
    apiKey: "key-alpha",
    profile: "drone",
    pairedAt: 1,
  };
}

/** An agent response carrying a vehicle acknowledgement. */
function ackResponse(accepted: boolean, extra: Record<string, unknown> = {}) {
  return new Response(
    JSON.stringify({
      status: "ok",
      cmd: "arm",
      ack: {
        observed: true,
        accepted,
        result: accepted ? 0 : 4,
        result_name: accepted ? "ACCEPTED" : "FAILED",
        ...extra,
      },
    }),
    { status: 200 },
  );
}

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  useLocalNodesStore.setState({ nodes: [] });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
  useLocalNodesStore.setState({ nodes: [] });
});

describe("transport selection", () => {
  it("uses the LAN transport when the node is LAN-paired", () => {
    useLocalNodesStore.setState({ nodes: [lanNode(DEVICE_ID)] });

    const sink = resolveNodeCommandSink(NODE, { originIsHttps: false });

    expect(sink?.transport).toBe("lan");
    // The LAN transport waits for the vehicle's own answer.
    expect(sink?.reportsVehicleAck).toBe(true);
  });

  it("uses the cloud queue when the node is only reachable there", () => {
    const enqueue = vi.fn(async () => ({ commandId: "cmd-1" }));

    const sink = resolveNodeCommandSink(NODE, {
      originIsHttps: false,
      enqueueCloudCommand: enqueue,
    });

    expect(sink?.transport).toBe("cloud");
    // A queued command has not reached the vehicle, so it carries no answer.
    expect(sink?.reportsVehicleAck).toBe(false);
  });

  it("prefers the LAN transport when both are available", () => {
    useLocalNodesStore.setState({ nodes: [lanNode(DEVICE_ID)] });
    const enqueue = vi.fn(async () => ({ commandId: "cmd-1" }));

    const sink = resolveNodeCommandSink(NODE, {
      originIsHttps: false,
      enqueueCloudCommand: enqueue,
    });

    expect(sink?.transport).toBe("lan");
  });

  it("falls back to the cloud queue when the origin blocks the LAN request", () => {
    useLocalNodesStore.setState({ nodes: [lanNode(DEVICE_ID)] });
    const enqueue = vi.fn(async () => ({ commandId: "cmd-1" }));

    const sink = resolveNodeCommandSink(NODE, {
      originIsHttps: true,
      enqueueCloudCommand: enqueue,
    });

    expect(sink?.transport).toBe("cloud");
  });

  it("keys LAN credentials on the device id, not another node's", () => {
    useLocalNodesStore.setState({ nodes: [lanNode("device-beta")] });

    const reach = resolveNodeCommandReach(
      { deviceId: DEVICE_ID },
      { originIsHttps: false },
    );

    expect(reach.sink).toBeNull();
  });
});

describe("unreachable nodes", () => {
  it("yields no surface for a node with no pairing of either kind", () => {
    const reach = resolveNodeCommandReach(
      { deviceId: DEVICE_ID },
      { originIsHttps: false },
    );

    expect(reach.sink).toBeNull();
    expect(reach.blockedReason).toBe("not-paired");
  });

  it("names the origin as the blocker when only the LAN path exists", () => {
    useLocalNodesStore.setState({ nodes: [lanNode(DEVICE_ID)] });

    const reach = resolveNodeCommandReach(NODE, { originIsHttps: true });

    expect(reach.sink).toBeNull();
    expect(reach.blockedReason).toBe("lan-blocked-by-https");
  });

  it("names the missing queue when the node is only cloud-paired", () => {
    const reach = resolveNodeCommandReach(NODE, { originIsHttps: false });

    expect(reach.sink).toBeNull();
    expect(reach.blockedReason).toBe("no-cloud-queue");
  });

  it("yields no surface for a directly-connected flight controller", () => {
    useLocalNodesStore.setState({ nodes: [lanNode(DEVICE_ID)] });

    const reach = resolveNodeCommandReach(
      { deviceId: DEVICE_ID, isDirectFc: true },
      { originIsHttps: false },
    );

    expect(reach.sink).toBeNull();
    expect(reach.blockedReason).toBe("direct-fc");
  });

  it("names the WFB relay, not an unpaired node, for a relayed-only drone", () => {
    // A relayed-only drone holds no LAN credentials and no cloud row, so it would
    // otherwise read "not-paired". The relay cause is the honest one.
    const reach = resolveNodeCommandReach(
      { deviceId: DEVICE_ID, isRelayed: true },
      { originIsHttps: false },
    );

    expect(reach.sink).toBeNull();
    expect(reach.blockedReason).toBe("relay-only");
  });
});

describe("LAN dispatch", () => {
  beforeEach(() => {
    useLocalNodesStore.setState({ nodes: [lanNode(DEVICE_ID)] });
  });

  it("posts the command name and arguments the agent route reads", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(ackResponse(true));
    globalThis.fetch = fetchSpy;

    const sink = resolveNodeCommandSink(NODE, { originIsHttps: false });
    const result = await sink!.takeoff(25);

    const [url, init] = fetchSpy.mock.calls[0] as [
      string,
      { body: string; headers: Record<string, string> },
    ];
    expect(url).toBe("http://alpha.example:8080/api/command");
    expect(JSON.parse(init.body)).toEqual({ cmd: "takeoff", args: [25] });
    expect(init.headers["X-ADOS-Key"]).toBe("key-alpha");
    expect(result.success).toBe(true);
  });

  it("passes the target mode through as the command argument", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(ackResponse(true));
    globalThis.fetch = fetchSpy;

    const sink = resolveNodeCommandSink(NODE, { originIsHttps: false });
    await sink!.setFlightMode("LOITER");

    const init = fetchSpy.mock.calls[0][1] as { body: string };
    expect(JSON.parse(init.body)).toEqual({ cmd: "mode", args: ["LOITER"] });
  });

  it("reports a rejected command as unsuccessful with the vehicle's reason", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(ackResponse(false, { statustext: "PreArm: GPS" }));

    const sink = resolveNodeCommandSink(NODE, { originIsHttps: false });
    const result = await sink!.arm();

    expect(result.success).toBe(false);
    expect(result.resultCode).toBe(4);
    expect(result.message).toBe("PreArm: GPS");
  });

  it("does not report success when the vehicle never acknowledged", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ status: "ok", cmd: "arm", ack: { observed: false } }),
        { status: 200 },
      ),
    );

    const sink = resolveNodeCommandSink(NODE, { originIsHttps: false });
    const result = await sink!.arm();

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/no acknowledgement/i);
  });

  it("reports the agent's own refusal instead of throwing", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: "FC not connected" }), {
        status: 503,
      }),
    );

    const sink = resolveNodeCommandSink(NODE, { originIsHttps: false });
    const result = await sink!.land();

    expect(result.success).toBe(false);
    expect(result.message).toContain("FC not connected");
  });
});

describe("cloud dispatch", () => {
  it("queues the command for the node's own device id", async () => {
    const enqueue = vi.fn(async () => ({ commandId: "cmd-7" }));

    const sink = resolveNodeCommandSink(NODE, {
      originIsHttps: false,
      enqueueCloudCommand: enqueue,
    });
    const result = await sink!.returnToLaunch();

    expect(enqueue).toHaveBeenCalledWith({
      deviceId: DEVICE_ID,
      command: "send_command",
      args: { cmd: "rtl", args: [] },
    });
    // Accepted onto the queue — and the message says only that.
    expect(result.success).toBe(true);
    expect(result.message).toContain("cmd-7");
    expect(result.message).toMatch(/has not acknowledged/i);
  });

  it("reports a queue write that failed", async () => {
    const enqueue = vi.fn(async () => {
      throw new Error("not authorised for this drone");
    });

    const sink = resolveNodeCommandSink(NODE, {
      originIsHttps: false,
      enqueueCloudCommand: enqueue,
    });
    const result = await sink!.disarm();

    expect(result.success).toBe(false);
    expect(result.message).toContain("not authorised");
  });
});

describe("commands the transport cannot carry", () => {
  beforeEach(() => {
    useLocalNodesStore.setState({ nodes: [lanNode(DEVICE_ID)] });
  });

  it("refuses them by name and dispatches nothing", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(ackResponse(true));
    globalThis.fetch = fetchSpy;

    const sink = resolveNodeCommandSink(NODE, { originIsHttps: false })!;

    for (const result of await Promise.all([
      sink.killSwitch(),
      sink.pauseMission(),
      sink.resumeMission(),
    ])) {
      expect(result.success).toBe(false);
      expect(result.message).toContain("no equivalent");
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("declares which commands it can carry", () => {
    const sink = resolveNodeCommandSink(NODE, { originIsHttps: false })!;

    for (const method of [
      "arm",
      "disarm",
      "setFlightMode",
      "returnToLaunch",
      "land",
      "takeoff",
    ] as const) {
      expect(sink.supports(method)).toBe(true);
    }
    for (const method of [
      "killSwitch",
      "pauseMission",
      "resumeMission",
    ] as const) {
      expect(sink.supports(method)).toBe(false);
    }
  });
});
