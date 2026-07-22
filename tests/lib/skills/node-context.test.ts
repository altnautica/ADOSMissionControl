/**
 * Tests for the per-node skill context.
 *
 * The load-bearing one is "reads arm state from the node, not the app-wide
 * store": the app-wide drone store is written by every connected drone's
 * heartbeat, so a context that read it would gate one node's controls on
 * another node's armed state. The rest cover the fields with no per-node
 * source, each of which must land on the value that offers LESS capability.
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

import {
  buildSkillContextForNode,
  availableModesForNode,
  firmwareTypeForNode,
  type SkillTargetNode,
} from "@/lib/skills/node-context";
import { armSkill, disarmSkill } from "@/lib/skills/builtins";
import { useCommandFleetStore } from "@/stores/command-fleet-store";
import { useDroneStore } from "@/stores/drone-store";
import { useChecklistStore } from "@/stores/checklist-store";
import { useLocalNodesStore, type LocalNode } from "@/stores/local-nodes-store";

const DEVICE_ID = "device-alpha";

const NODE: SkillTargetNode = {
  _id: `node:${DEVICE_ID}`,
  deviceId: DEVICE_ID,
  fcFirmware: "ardupilot",
  frameType: "Copter",
};

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

/** Publish a heartbeat-row snapshot for a node, the way the LAN poll does. */
function publishTelemetry(
  deviceId: string,
  telemetry: { armed?: boolean; mode?: string },
): void {
  useCommandFleetStore.getState().upsertCloudStatuses([
    { deviceId, telemetry, updatedAt: Date.now() },
  ]);
}

/** Publish live-stream telemetry for a node, the way the MQTT bridge does. */
function streamTelemetry(
  deviceId: string,
  telemetry: { armed?: boolean; mode?: string },
): void {
  useCommandFleetStore.getState().setTelemetry(deviceId, telemetry);
}

beforeEach(() => {
  useCommandFleetStore.getState().clear();
  useLocalNodesStore.setState({ nodes: [lanNode(DEVICE_ID)] });
});

afterEach(() => {
  useCommandFleetStore.getState().clear();
  useLocalNodesStore.setState({ nodes: [] });
  vi.restoreAllMocks();
});

describe("per-node state sourcing", () => {
  it("reads arm state from the node, not the app-wide store", () => {
    // The app-wide store holds ARMED — written by whichever drone last sent a
    // heartbeat, which is not necessarily this node.
    useDroneStore.setState({ armState: "armed", flightMode: "AUTO" });
    // This node's own telemetry says otherwise.
    publishTelemetry(DEVICE_ID, { armed: false, mode: "LOITER" });

    const ctx = buildSkillContextForNode(NODE, { originIsHttps: false });

    expect(ctx.armState).toBe("disarmed");
    expect(ctx.flightMode).toBe("LOITER");
    // And the disagreement is real: the app-wide store still says armed.
    expect(useDroneStore.getState().armState).toBe("armed");
  });

  it("gates the arm skill on the node's own state", () => {
    useDroneStore.setState({ armState: "armed" });
    publishTelemetry(DEVICE_ID, { armed: false, mode: "LOITER" });

    const ctx = buildSkillContextForNode(NODE, { originIsHttps: false });

    // Reading the app-wide store would report already-armed and hide the
    // control; the node is disarmed, so arming is offered and disarming is not.
    expect(armSkill.getState(ctx).kind).toBe("idle");
    expect(disarmSkill.getState(ctx)).toEqual({
      kind: "disabled",
      reason: "skills.reason.alreadyDisarmed",
    });
  });

  it("keys telemetry on the node's device id", () => {
    publishTelemetry("device-beta", { armed: true, mode: "AUTO" });

    const ctx = buildSkillContextForNode(NODE, { originIsHttps: false });

    // Another node's snapshot must not stand in for this one's.
    expect(ctx.protocol).toBeNull();
  });

  it("carries the node's fleet id so per-node dispatch guards stay separate", () => {
    publishTelemetry(DEVICE_ID, { armed: false });

    const ctx = buildSkillContextForNode(NODE, { originIsHttps: false });

    expect(ctx.droneId).toBe(NODE._id);
  });
});

describe("cloud command lane", () => {
  // A node paired only through the cloud relay: no LAN credentials in this
  // browser, telemetry streamed over MQTT, and a heartbeat row that carries no
  // telemetry snapshot at all — the exact shape production produces for it.
  const CLOUD_DEVICE_ID = "device-cloud";
  const CLOUD_NODE: SkillTargetNode = {
    _id: `node:${CLOUD_DEVICE_ID}`,
    deviceId: CLOUD_DEVICE_ID,
    convexId: "convex-row-1",
    fcFirmware: "ardupilot",
    frameType: "Copter",
  };
  const enqueue = async () => ({ commandId: "cmd-1" });

  it("offers a command surface from streamed telemetry alone", () => {
    useCommandFleetStore.getState().upsertCloudStatuses([
      { deviceId: CLOUD_DEVICE_ID, updatedAt: Date.now() },
    ]);
    streamTelemetry(CLOUD_DEVICE_ID, { armed: true, mode: "GUIDED" });

    const ctx = buildSkillContextForNode(CLOUD_NODE, {
      originIsHttps: true,
      enqueueCloudCommand: enqueue,
    });

    // The regression this pins: the live stream is the only telemetry a
    // cloud-paired node produces, and it must be enough to open the lane.
    expect(ctx.protocol).not.toBeNull();
    expect(ctx.armState).toBe("armed");
    expect(ctx.flightMode).toBe("GUIDED");
    expect(disarmSkill.getState(ctx).kind).toBe("idle");
  });

  it("prefers the live stream over the heartbeat row, like the display", () => {
    useCommandFleetStore.getState().upsertCloudStatuses([
      {
        deviceId: CLOUD_DEVICE_ID,
        telemetry: { armed: false, mode: "LOITER" },
        updatedAt: Date.now(),
      },
    ]);
    streamTelemetry(CLOUD_DEVICE_ID, { armed: true, mode: "AUTO" });

    const ctx = buildSkillContextForNode(CLOUD_NODE, {
      originIsHttps: true,
      enqueueCloudCommand: enqueue,
    });

    // The display cells read stream-first; the gate must read the same value
    // or the row would render ARMED beside controls gated on disarmed.
    expect(ctx.armState).toBe("armed");
    expect(ctx.flightMode).toBe("AUTO");
  });
});

describe("state that cannot be sourced per node", () => {
  it("offers no command surface when the node's arm state is unproven", () => {
    // Reachable over the LAN, but no telemetry snapshot has arrived.
    const ctx = buildSkillContextForNode(NODE, { originIsHttps: false });

    expect(ctx.protocol).toBeNull();
    expect(armSkill.getState(ctx)).toEqual({
      kind: "disabled",
      reason: "skills.reason.noFcLink",
    });
  });

  it("offers no command surface for an offline node, whatever it last sent", () => {
    // A dead node leaves its last snapshot behind in both telemetry maps and
    // its LAN credentials never expire. Ten minutes of silence makes the
    // persisted armed flag proof of nothing, so no control may run on it.
    const TEN_MINUTES_AGO = Date.now() - 10 * 60_000;
    useCommandFleetStore.getState().upsertCloudStatuses([
      {
        deviceId: DEVICE_ID,
        telemetry: { armed: false, mode: "LOITER" },
        updatedAt: TEN_MINUTES_AGO,
      },
    ]);
    streamTelemetry(DEVICE_ID, { armed: false, mode: "LOITER" });

    const ctx = buildSkillContextForNode(
      { ...NODE, lastSeen: TEN_MINUTES_AGO },
      { originIsHttps: false },
    );

    expect(ctx.protocol).toBeNull();
    expect(armSkill.getState(ctx).kind).toBe("disabled");
  });

  it("keeps the command surface through the stale window", () => {
    // Stale (heard from within the offline threshold) dims the readings but is
    // not gone; blocking there would flap controls on every slow heartbeat.
    useCommandFleetStore.getState().upsertCloudStatuses([
      {
        deviceId: DEVICE_ID,
        telemetry: { armed: false, mode: "LOITER" },
        updatedAt: Date.now() - 50_000,
      },
    ]);

    const ctx = buildSkillContextForNode(NODE, { originIsHttps: false });

    expect(ctx.protocol).not.toBeNull();
  });

  it("offers a command surface once the node's state is readable", () => {
    publishTelemetry(DEVICE_ID, { armed: false, mode: "LOITER" });

    const ctx = buildSkillContextForNode(NODE, { originIsHttps: false });

    expect(ctx.protocol).not.toBeNull();
  });

  it("reports no capabilities, because no handshake has happened", () => {
    publishTelemetry(DEVICE_ID, { armed: true, mode: "AUTO" });

    const ctx = buildSkillContextForNode(NODE, { originIsHttps: false });

    expect(ctx.supports("supportsMissionUpload")).toBe(false);
    expect(ctx.supports("supportsGeoFence")).toBe(false);
  });

  it("reports the checklist as not ready even when the app-wide one is", () => {
    useChecklistStore.setState({
      items: useChecklistStore
        .getState()
        .items.map((item) => ({ ...item, status: "pass" as const })),
    });
    publishTelemetry(DEVICE_ID, { armed: false });

    const ctx = buildSkillContextForNode(NODE, { originIsHttps: false });

    // The checklist carries no node association, so it cannot vouch for this
    // vehicle; arm and take-off ask for the override phrase instead.
    expect(useChecklistStore.getState().isReadyToArm()).toBe(true);
    expect(ctx.checklistReady).toBe(false);
  });

  it("asserts no mode transition, so nothing infers a paused mission", () => {
    publishTelemetry(DEVICE_ID, { armed: true, mode: "LOITER" });

    const ctx = buildSkillContextForNode(NODE, { originIsHttps: false });

    expect(ctx.previousMode).toBe(ctx.flightMode);
  });

  it("falls back to a mode naming no autonomy when the name is unknown", () => {
    publishTelemetry(DEVICE_ID, { armed: true, mode: "SOMETHING_NEW" });

    const ctx = buildSkillContextForNode(NODE, { originIsHttps: false });

    expect(ctx.flightMode).toBe("MANUAL");
  });
});

describe("available modes", () => {
  it("resolves the firmware build from the family and airframe", () => {
    expect(firmwareTypeForNode("ardupilot", "Copter")).toBe(
      "ardupilot-copter",
    );
    expect(firmwareTypeForNode("ardupilot", "VTOL")).toBe("ardupilot-plane");
    expect(firmwareTypeForNode("ardupilot", "Boat")).toBe("ardupilot-rover");
    expect(firmwareTypeForNode("ardupilot", "Sub")).toBe("ardupilot-sub");
    expect(firmwareTypeForNode("px4")).toBe("px4");
    expect(firmwareTypeForNode("betaflight")).toBe("betaflight");
    expect(firmwareTypeForNode("inav")).toBe("inav");
  });

  it("resolves nothing when the firmware or airframe is unidentified", () => {
    expect(firmwareTypeForNode(undefined, "Copter")).toBeNull();
    expect(firmwareTypeForNode("unknown", "Copter")).toBeNull();
    expect(firmwareTypeForNode("ardupilot")).toBeNull();
    expect(firmwareTypeForNode("ardupilot", "Submersible")).toBeNull();
  });

  it("offers the identified firmware's own mode table", () => {
    const modes = availableModesForNode("ardupilot", "Copter");

    expect(modes).toContain("LOITER");
    expect(modes).toContain("GUIDED");
  });

  it("offers no modes when the firmware is unidentified", () => {
    // An empty table reports every mode preset as unavailable, rather than
    // offering a mode the vehicle may not have.
    expect(availableModesForNode(undefined, undefined)).toEqual([]);
    expect(availableModesForNode("unknown", "Copter")).toEqual([]);
  });

  it("puts the node's mode table on the context", () => {
    publishTelemetry(DEVICE_ID, { armed: false, mode: "STABILIZE" });

    const ctx = buildSkillContextForNode(NODE, { originIsHttps: false });

    expect(ctx.availableModes).toContain("LOITER");
  });
});
