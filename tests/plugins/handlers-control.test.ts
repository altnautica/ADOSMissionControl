/**
 * Adversarial tests for the safety-critical / event / cloud plugin handlers.
 *
 * Every test here asserts a GATE REJECTS: a hard-blocked command never reaches
 * the protocol, an unconfirmed command/mission never fires, a cross-drone token
 * is refused, an armed vehicle refuses a mission write, an invalid mission is
 * refused before confirm, off-allowlist + over-rate cloud reads are denied, and
 * cloud writes are always denied. The bus delivery path is exercised too.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type { BridgeHandlerContext } from "@/lib/plugins/bridge";

// ── Mocked leaf deps (kept isolated from the real Zustand store graph) ──

const { validateMissionMock } = vi.hoisted(() => ({
  validateMissionMock: vi.fn(),
}));

let droneManagerState: { drones: Map<string, { protocol: unknown }> };
vi.mock("@/stores/drone-manager", () => ({
  useDroneManager: { getState: () => droneManagerState },
}));

/**
 * Arm state is PER DRONE, read from the node registry for the plugin's own
 * bound device. The handlers used to read the single-slot `drone-store`, which
 * holds the operator's SELECTED drone — so a plugin bound to drone B checked
 * drone A's arm state and then uploaded to drone A as well.
 */
let armState: "armed" | "disarmed" | "unknown";
vi.mock("@/stores/node-registry", () => ({
  useNodeRegistryStore: {
    getState: () => ({
      getEntry: (id: string) =>
        droneManagerState.drones.has(id)
          ? { fc: { armState }, connection: { fcConnected: true } }
          : undefined,
    }),
  },
}));

const missionStore = {
  setWaypoints: vi.fn(),
  uploadMission: vi.fn(async () => true),
  // mission.read fields, present so the wider handler set never throws.
  waypoints: [] as unknown[],
  activeMission: null,
  progress: 0,
  currentWaypoint: 0,
};
vi.mock("@/stores/mission-store", () => ({
  useMissionStore: { getState: () => missionStore },
}));

vi.mock("@/lib/validation/mission-validator", () => ({
  validateMission: validateMissionMock,
}));

vi.mock("@/lib/telemetry-recorder", () => ({
  startRecordingFor: vi.fn(() => "rec-1"),
  stopRecordingFor: vi.fn(async () => ({ id: "rec-1" })),
  markRecording: vi.fn(() => true),
}));

vi.mock("@/lib/plugins/notifier", () => ({ pluginNotify: vi.fn() }));

import { buildPluginHandlers } from "@/lib/plugins/handlers";
import { HARD_BLOCKED_COMMAND_IDS } from "@/lib/plugins/handlers/control";
import {
  PLUGIN_CONFIRM_TIMEOUT_MS,
  requestPluginConfirm,
  setPluginConfirmHandler,
  type PluginConfirmRequest,
} from "@/lib/plugins/confirm";
import {
  publishPluginEvent,
  resetPluginEventBus,
} from "@/lib/plugins/event-bus";
import {
  resetCloudRateLimits,
  CLOUD_RATE_LIMIT_MAX,
} from "@/lib/plugins/cloud-allowlist";
import {
  resetCommandRateLimits,
  COMMAND_RATE_LIMIT_MAX,
} from "@/lib/plugins/handlers/command-rate";

const DEPS = { translate: vi.fn((k: string) => `t:${k}`) };

let confirmAnswer = true;
let confirmSpy: ReturnType<typeof vi.fn>;

function makeCtx(opts?: {
  capability?: string | null;
  agentId?: string | null;
}): { ctx: BridgeHandlerContext; postEvent: ReturnType<typeof vi.fn> } {
  const postEvent = vi.fn();
  const claims =
    opts?.agentId != null
      ? ({ agentId: opts.agentId } as unknown as BridgeHandlerContext["claims"])
      : null;
  return {
    ctx: {
      pluginId: "com.example.plug",
      capability: opts?.capability ?? null,
      postEvent,
      claims,
    },
    postEvent,
  };
}

function okResult() {
  return { success: true, resultCode: 0, message: "" };
}

/** Install a drone "d1" whose protocol carries a sendCommand spy. */
function withProtocol(sendCommand = vi.fn(async () => okResult())) {
  droneManagerState = { drones: new Map([["node:d1", { protocol: { sendCommand } }]]) };
  return { sendCommand };
}

function WP(id: string, over: Record<string, unknown> = {}) {
  return { id, lat: 1, lon: 2, alt: 30, ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetPluginEventBus();
  resetCloudRateLimits();
  resetCommandRateLimits();
  armState = "disarmed";
  droneManagerState = { drones: new Map() };
  validateMissionMock.mockReturnValue({ valid: true, errors: [], warnings: [] });
  missionStore.uploadMission.mockResolvedValue(true);
  confirmAnswer = true;
  confirmSpy = vi.fn(async () => confirmAnswer);
  setPluginConfirmHandler(
    confirmSpy as unknown as (req: PluginConfirmRequest) => Promise<boolean>,
  );
});

afterEach(() => {
  setPluginConfirmHandler(null);
});

describe("command.send gates", () => {
  it("the hard-block set is exactly arm / motor-test / calibrate / reboot", () => {
    expect(new Set(HARD_BLOCKED_COMMAND_IDS)).toEqual(
      new Set([400, 209, 241, 246]),
    );
  });

  it.each(["arm", "disarm", "motor_test", "calibrate", "reboot", "frobnicate"])(
    "refuses the un-allowlisted command name '%s' without prompting or sending",
    async (name) => {
      const { sendCommand } = withProtocol();
      const { handlers } = buildPluginHandlers("p", "node:d1", DEPS);
      const { ctx } = makeCtx({ capability: "command.send" });
      const out = await handlers["command.send"]({ command: name }, ctx);
      expect(out).toEqual({
        ok: false,
        error: `command '${name}' is not permitted from plugins`,
      });
      expect(sendCommand).not.toHaveBeenCalled();
      expect(confirmSpy).not.toHaveBeenCalled();
    },
  );

  it("requires a string command name", async () => {
    withProtocol();
    const { handlers } = buildPluginHandlers("p", "node:d1", DEPS);
    const { ctx } = makeCtx({ capability: "command.send" });
    const out = await handlers["command.send"]({ commandId: 22 }, ctx);
    expect(out).toEqual({
      ok: false,
      error: "command.send requires a command name",
    });
  });

  it("maps takeoff to MAV_CMD 22 with a clamped altitude after confirm", async () => {
    const { sendCommand } = withProtocol();
    const { handlers } = buildPluginHandlers("p", "node:d1", DEPS);
    const { ctx } = makeCtx({ capability: "command.send" });
    const out = await handlers["command.send"](
      { command: "takeoff", args: { alt: 25 } },
      ctx,
    );
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(sendCommand).toHaveBeenCalledWith(22, [0, 0, 0, 0, 0, 0, 25]);
    expect(out).toEqual({ ok: true, result: okResult() });
  });

  it("clamps the takeoff altitude into the 1..120 m band", async () => {
    const { sendCommand } = withProtocol();
    const { handlers } = buildPluginHandlers("p", "node:d1", DEPS);
    const { ctx } = makeCtx({ capability: "command.send" });
    await handlers["command.send"](
      { command: "takeoff", args: { alt: 9999 } },
      ctx,
    );
    expect(sendCommand).toHaveBeenCalledWith(22, [0, 0, 0, 0, 0, 0, 120]);
  });

  it("rejects takeoff with no/invalid altitude before sending", async () => {
    const { sendCommand } = withProtocol();
    const { handlers } = buildPluginHandlers("p", "node:d1", DEPS);
    const { ctx } = makeCtx({ capability: "command.send" });
    const out = await handlers["command.send"](
      { command: "takeoff", args: {} },
      ctx,
    );
    expect(out).toEqual({ ok: false, error: "invalid args for 'takeoff'" });
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it.each([
    ["land", 21],
    ["rtl", 20],
  ])("maps %s to MAV_CMD %i after confirm", async (name, id) => {
    const { sendCommand } = withProtocol();
    const { handlers } = buildPluginHandlers("p", "node:d1", DEPS);
    const { ctx } = makeCtx({ capability: "command.send" });
    const out = await handlers["command.send"]({ command: name }, ctx);
    expect(sendCommand).toHaveBeenCalledWith(id, [0, 0, 0, 0, 0, 0, 0]);
    expect(out).toEqual({ ok: true, result: okResult() });
  });

  it("denies an allowlisted command when the operator declines", async () => {
    confirmAnswer = false;
    const { sendCommand } = withProtocol();
    const { handlers } = buildPluginHandlers("p", "node:d1", DEPS);
    const { ctx } = makeCtx({ capability: "command.send" });
    const out = await handlers["command.send"]({ command: "rtl" }, ctx);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ ok: false, error: "operator denied" });
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it("escalates the confirm to critical when the vehicle is armed", async () => {
    armState = "armed";
    withProtocol();
    const { handlers } = buildPluginHandlers("p", "node:d1", DEPS);
    const { ctx } = makeCtx({ capability: "command.send" });
    await handlers["command.send"]({ command: "rtl" }, ctx);
    const arg = confirmSpy.mock.calls[0][0];
    expect(arg.severity).toBe("critical");
    expect(arg.body).toMatch(/ARMED/);
  });

  it("rejects a token whose agentId targets a different drone", async () => {
    const { sendCommand } = withProtocol();
    const { handlers } = buildPluginHandlers("p", "node:d1", DEPS);
    const { ctx } = makeCtx({ capability: "command.send", agentId: "other-drone" });
    const out = await handlers["command.send"]({ command: "rtl" }, ctx);
    expect(out).toEqual({ ok: false, error: "command.send target mismatch" });
    expect(sendCommand).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("reports not supported when the scoped drone has no protocol", async () => {
    droneManagerState = { drones: new Map() };
    const { handlers } = buildPluginHandlers("p", "node:d1", DEPS);
    const { ctx } = makeCtx({ capability: "command.send" });
    const out = await handlers["command.send"]({ command: "rtl" }, ctx);
    expect(out).toEqual({ ok: false, error: "command.send not supported" });
  });

  it("reports not supported when sendCommand is absent on the protocol", async () => {
    droneManagerState = { drones: new Map([["node:d1", { protocol: {} }]]) };
    const { handlers } = buildPluginHandlers("p", "node:d1", DEPS);
    const { ctx } = makeCtx({ capability: "command.send" });
    const out = await handlers["command.send"]({ command: "rtl" }, ctx);
    expect(out).toEqual({ ok: false, error: "command.send not supported" });
  });

  it("does not send when the vehicle armed while the operator was deciding", async () => {
    const { sendCommand } = withProtocol();
    confirmSpy.mockImplementation(async () => {
      armState = "armed";
      return true;
    });
    const { handlers } = buildPluginHandlers("p", "node:d1", DEPS);
    const { ctx } = makeCtx({ capability: "command.send" });
    const out = await handlers["command.send"]({ command: "rtl" }, ctx);
    expect(out).toMatchObject({ ok: false });
    expect(String((out as { error?: unknown }).error)).toMatch(/changed while awaiting approval/);
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it("denies a confirmation nobody answers within the window", async () => {
    vi.useFakeTimers();
    try {
      setPluginConfirmHandler(() => new Promise<boolean>(() => {}));
      const pending = requestPluginConfirm({ pluginId: "p", targetName: "Drone 1", title: "t", body: "b" });
      await vi.advanceTimersByTimeAsync(PLUGIN_CONFIRM_TIMEOUT_MS);
      await expect(pending).resolves.toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rate-limits confirmed command sends", async () => {
    const { sendCommand } = withProtocol();
    const { handlers } = buildPluginHandlers("p", "node:d1", DEPS);
    const { ctx } = makeCtx({ capability: "command.send" });
    for (let i = 0; i < COMMAND_RATE_LIMIT_MAX; i += 1) {
      const out = await handlers["command.send"]({ command: "rtl" }, ctx);
      expect(out).toMatchObject({ ok: true });
    }
    const tripped = await handlers["command.send"]({ command: "rtl" }, ctx);
    expect(tripped).toEqual({ ok: false, error: "command rate limit exceeded" });
    expect(sendCommand).toHaveBeenCalledTimes(COMMAND_RATE_LIMIT_MAX);
  });
});

describe("mission.write gates", () => {
  it("refuses to write when the plugin is not bound to a connected drone", async () => {
    // No drone installed. `uploadMission()` with no target falls back to the
    // operator's SELECTED drone, so refusing here is what stops a plugin bound
    // to an absent device from uploading to whatever is on screen.
    droneManagerState = { drones: new Map() };
    const { handlers } = buildPluginHandlers("p", "node:d1", DEPS);
    const { ctx } = makeCtx({ capability: "mission.write" });
    const out = await handlers["mission.write"](
      { payload: { waypoints: [WP("w1"), WP("w2")] } },
      ctx,
    );
    expect(out).toEqual({
      ok: false,
      error: "plugin is not bound to a connected drone",
    });
    expect(missionStore.uploadMission).not.toHaveBeenCalled();
  });

  it("uploads to the plugin's OWN drone, never the selected one", async () => {
    const protocol = { sendCommand: vi.fn(async () => okResult()) };
    const otherProtocol = { sendCommand: vi.fn(async () => okResult()) };
    droneManagerState = {
      drones: new Map([
        ["node:d1", { protocol }],
        ["node:d2", { protocol: otherProtocol }],
      ]),
    };
    const wps = [WP("w1"), WP("w2")];
    const { handlers } = buildPluginHandlers("p", "node:d1", DEPS);
    const { ctx } = makeCtx({ capability: "mission.write" });
    const out = await handlers["mission.write"]({ payload: { waypoints: wps } }, ctx);
    expect(out).toEqual({ ok: true });
    // The target is passed EXPLICITLY, so the store cannot substitute the
    // operator's selection.
    expect(missionStore.uploadMission).toHaveBeenCalledWith(protocol);
  });

  it("refuses to write while the vehicle is armed", async () => {
    armState = "armed";
    withProtocol();
    const { handlers } = buildPluginHandlers("p", "node:d1", DEPS);
    const { ctx } = makeCtx({ capability: "mission.write" });
    const out = await handlers["mission.write"](
      { payload: { waypoints: [WP("w1"), WP("w2")] } },
      ctx,
    );
    expect(out).toEqual({ ok: false, error: "cannot write mission while armed" });
    expect(missionStore.setWaypoints).not.toHaveBeenCalled();
    expect(missionStore.uploadMission).not.toHaveBeenCalled();
    expect(validateMissionMock).not.toHaveBeenCalled();
  });

  it("refuses to write while the arm state is unknown after a lost link", async () => {
    armState = "unknown";
    withProtocol();
    const { handlers } = buildPluginHandlers("p", "node:d1", DEPS);
    const { ctx } = makeCtx({ capability: "mission.write" });
    const out = await handlers["mission.write"](
      { payload: { waypoints: [WP("w1"), WP("w2")] } },
      ctx,
    );
    expect(out).toEqual({
      ok: false,
      error: "cannot write mission while the arm state is unknown",
    });
    expect(missionStore.uploadMission).not.toHaveBeenCalled();
  });

  it("rejects an invalid mission with the validator errors, before confirm", async () => {
    validateMissionMock.mockReturnValue({
      valid: false,
      errors: [{ code: "EMPTY_MISSION" }],
      warnings: [],
    });
    withProtocol();
    const { handlers } = buildPluginHandlers("p", "node:d1", DEPS);
    const { ctx } = makeCtx({ capability: "mission.write" });
    const out = await handlers["mission.write"](
      { payload: { waypoints: [WP("w1")] } },
      ctx,
    );
    expect(out).toEqual({
      ok: false,
      error: "invalid mission",
      errors: [{ code: "EMPTY_MISSION" }],
    });
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(missionStore.setWaypoints).not.toHaveBeenCalled();
  });

  it("rejects a non-array payload.waypoints", async () => {
    const { handlers } = buildPluginHandlers("p", "node:d1", DEPS);
    const { ctx } = makeCtx({ capability: "mission.write" });
    const out = await handlers["mission.write"](
      { payload: { waypoints: "nope" } },
      ctx,
    );
    expect(out).toMatchObject({ ok: false });
    expect((out as { error: string }).error).toMatch(/payload\.waypoints/);
    expect(validateMissionMock).not.toHaveBeenCalled();
  });

  it("rejects a missing payload", async () => {
    const { handlers } = buildPluginHandlers("p", "node:d1", DEPS);
    const { ctx } = makeCtx({ capability: "mission.write" });
    const out = await handlers["mission.write"]({ missionId: "active" }, ctx);
    expect(out).toMatchObject({ ok: false });
    expect(validateMissionMock).not.toHaveBeenCalled();
  });

  it("rejects waypoints missing numeric coordinates", async () => {
    const { handlers } = buildPluginHandlers("p", "node:d1", DEPS);
    const { ctx } = makeCtx({ capability: "mission.write" });
    const out = await handlers["mission.write"](
      { payload: { waypoints: [{ id: "w1", lat: "x", lon: 2, alt: 3 }] } },
      ctx,
    );
    expect(out).toMatchObject({ ok: false });
    expect(validateMissionMock).not.toHaveBeenCalled();
  });

  it("rejects a valid mission when the operator declines", async () => {
    confirmAnswer = false;
    withProtocol();
    const { handlers } = buildPluginHandlers("p", "node:d1", DEPS);
    const { ctx } = makeCtx({ capability: "mission.write" });
    const out = await handlers["mission.write"](
      { payload: { waypoints: [WP("w1"), WP("w2")] } },
      ctx,
    );
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ ok: false, error: "operator denied" });
    expect(missionStore.setWaypoints).not.toHaveBeenCalled();
    expect(missionStore.uploadMission).not.toHaveBeenCalled();
  });

  it("writes + uploads a confirmed valid mission", async () => {
    const wps = [WP("w1"), WP("w2")];
    withProtocol();
    const { handlers } = buildPluginHandlers("p", "node:d1", DEPS);
    const { ctx } = makeCtx({ capability: "mission.write" });
    const out = await handlers["mission.write"](
      { payload: { waypoints: wps } },
      ctx,
    );
    expect(missionStore.setWaypoints).toHaveBeenCalledWith(wps);
    expect(missionStore.uploadMission).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ ok: true });
  });
});

describe("events pub/sub", () => {
  it("delivers a plugin-published event to its subscriber", async () => {
    const { handlers } = buildPluginHandlers("p", "node:d1", DEPS);
    const { ctx, postEvent } = makeCtx({ capability: "event.subscribe" });
    const subAck = await handlers["events.subscribe"](
      { topic: "plugin.demo.evt" },
      ctx,
    );
    expect(subAck).toEqual({ ok: true });
    const pubAck = await handlers["events.publish"](
      { topic: "plugin.demo.evt", payload: { n: 7 } },
      ctx,
    );
    expect(pubAck).toEqual({ ok: true });
    expect(postEvent).toHaveBeenCalledWith(
      "plugin.demo.evt",
      "event.subscribe",
      { n: 7 },
    );
  });

  it("forwards an externally published event to the plugin", async () => {
    const { handlers } = buildPluginHandlers("p", "node:d1", DEPS);
    const { ctx, postEvent } = makeCtx({ capability: "event.subscribe" });
    await handlers["events.subscribe"]({ topic: "vehicle.armed" }, ctx);
    publishPluginEvent("vehicle.armed", { armed: true }, "other");
    expect(postEvent).toHaveBeenCalledWith(
      "vehicle.armed",
      "event.subscribe",
      { armed: true },
    );
  });

  it("events.unsubscribe stops delivery; dispose is idempotent after it", async () => {
    const { handlers, dispose } = buildPluginHandlers("p", "node:d1", DEPS);
    const { ctx, postEvent } = makeCtx({ capability: "event.subscribe" });
    await handlers["events.subscribe"]({ topic: "t.x" }, ctx);
    await handlers["events.unsubscribe"]({ topic: "t.x" }, ctx);
    publishPluginEvent("t.x", { a: 1 }, "p");
    expect(postEvent).not.toHaveBeenCalled();
    expect(() => dispose()).not.toThrow();
  });

  it("dispose tears down a still-open subscription", async () => {
    const { handlers, dispose } = buildPluginHandlers("p", "node:d1", DEPS);
    const { ctx, postEvent } = makeCtx({ capability: "event.subscribe" });
    await handlers["events.subscribe"]({ topic: "t.y" }, ctx);
    dispose();
    publishPluginEvent("t.y", { a: 1 }, "p");
    expect(postEvent).not.toHaveBeenCalled();
  });
});

describe("cloud.read / cloud.write gates", () => {
  it("rejects an off-allowlist cloud.read without touching the client", async () => {
    const cloudQuery = vi.fn(async () => ({}));
    const { handlers } = buildPluginHandlers("p", "node:d1", { ...DEPS, cloudQuery });
    const { ctx } = makeCtx({ capability: "cloud.read" });
    const out = await handlers["cloud.read"]({ fn: "cmdDrones:list" }, ctx);
    expect(out).toEqual({ ok: false, error: "not allowed" });
    expect(cloudQuery).not.toHaveBeenCalled();
  });

  it("runs an allowlisted cloud.read through the injected client", async () => {
    const cloudQuery = vi.fn(async () => ({ token: "abc" }));
    const { handlers } = buildPluginHandlers("p", "node:d1", { ...DEPS, cloudQuery });
    const { ctx } = makeCtx({ capability: "cloud.read" });
    const out = await handlers["cloud.read"](
      { fn: "clientConfig:getClientConfig", args: { a: 1 } },
      ctx,
    );
    expect(cloudQuery).toHaveBeenCalledWith("clientConfig:getClientConfig", {
      a: 1,
    });
    expect(out).toEqual({ ok: true, result: { token: "abc" } });
  });

  it("reports cloud unavailable when no client is wired", async () => {
    const { handlers } = buildPluginHandlers("p", "node:d1", DEPS);
    const { ctx } = makeCtx({ capability: "cloud.read" });
    const out = await handlers["cloud.read"](
      { fn: "communityChangelog:list" },
      ctx,
    );
    expect(out).toEqual({ ok: false, error: "cloud unavailable" });
  });

  it("rejects non-object args before reaching the client", async () => {
    const cloudQuery = vi.fn(async () => ({}));
    const { handlers } = buildPluginHandlers("p", "node:d1", { ...DEPS, cloudQuery });
    const { ctx } = makeCtx({ capability: "cloud.read" });
    const out = await handlers["cloud.read"](
      { fn: "communityItems:list", args: [1, 2] },
      ctx,
    );
    expect(out).toMatchObject({ ok: false });
    expect(cloudQuery).not.toHaveBeenCalled();
  });

  it("rate-limits cloud.read", async () => {
    const cloudQuery = vi.fn(async () => ({}));
    const { handlers } = buildPluginHandlers("p", "node:d1", { ...DEPS, cloudQuery });
    const { ctx } = makeCtx({ capability: "cloud.read" });
    for (let i = 0; i < CLOUD_RATE_LIMIT_MAX; i += 1) {
      const out = await handlers["cloud.read"]({ fn: "communityItems:list" }, ctx);
      expect(out).toMatchObject({ ok: true });
    }
    const tripped = await handlers["cloud.read"](
      { fn: "communityItems:list" },
      ctx,
    );
    expect(tripped).toEqual({ ok: false, error: "rate limit exceeded" });
  });

  it("always refuses cloud.write, even on-allowlist-shaped calls", async () => {
    const cloudQuery = vi.fn(async () => ({}));
    const { handlers } = buildPluginHandlers("p", "node:d1", { ...DEPS, cloudQuery });
    const { ctx } = makeCtx({ capability: "cloud.write" });
    const out = await handlers["cloud.write"](
      { fn: "comments:create", args: {} },
      ctx,
    );
    expect(out).toEqual({
      ok: false,
      error: "cloud writes are not permitted for plugins",
    });
    expect(cloudQuery).not.toHaveBeenCalled();
  });
});
