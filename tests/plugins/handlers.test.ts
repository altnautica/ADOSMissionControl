import { describe, it, expect, beforeEach, vi } from "vitest";

import type { BridgeHandlerContext } from "@/lib/plugins/bridge";

// ── Mock the leaf dependencies the handlers reach into ──────────────────

const missionState = {
  waypoints: [{ id: "w1", lat: 1, lon: 2, alt: 30 }],
  activeMission: {
    id: "m1",
    name: "M",
    droneId: "d1",
    waypoints: [{ id: "w1", lat: 1, lon: 2, alt: 30 }],
    state: "planning",
    progress: 0,
    currentWaypoint: 0,
  },
  progress: 0.5,
  currentWaypoint: 1,
};

vi.mock("@/stores/mission-store", () => ({
  useMissionStore: { getState: () => missionState },
}));

vi.mock("@/lib/telemetry-recorder", () => ({
  startMirrorRecording: vi.fn(() => "rec-1"),
  stopRecordingFor: vi.fn(async () => ({ id: "rec-1" })),
  markRecording: vi.fn(() => true),
  isRecordingFor: vi.fn(() => false),
}));

vi.mock("@/lib/plugins/notifier", () => ({
  pluginNotify: vi.fn(),
}));

let droneManagerState: {
  drones: Map<string, { protocol: unknown }>;
  getSelectedProtocol: () => unknown;
};

vi.mock("@/stores/drone-manager", () => ({
  useDroneManager: { getState: () => droneManagerState },
}));

import { buildPluginHandlers } from "@/lib/plugins/handlers";
import { pluginNotify } from "@/lib/plugins/notifier";
import {
  startMirrorRecording,
  stopRecordingFor,
  markRecording,
  isRecordingFor,
} from "@/lib/telemetry-recorder";

function makeCtx(capability: string | null = null): {
  ctx: BridgeHandlerContext;
  postEvent: ReturnType<typeof vi.fn>;
} {
  const postEvent = vi.fn();
  return {
    ctx: { pluginId: "com.example.plug", capability, postEvent, claims: null },
    postEvent,
  };
}

const DEPS = { translate: vi.fn((key: string) => `t:${key}`) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isRecordingFor).mockReturnValue(false);
  droneManagerState = { drones: new Map(), getSelectedProtocol: () => null };
});

describe("buildPluginHandlers", () => {
  it("ping returns { ok: true }", async () => {
    const { handlers } = buildPluginHandlers("p", "node:d1", DEPS);
    const { ctx } = makeCtx();
    expect(await handlers.ping({}, ctx)).toEqual({ ok: true });
  });

  it("i18n.t delegates to deps.translate", async () => {
    const { handlers } = buildPluginHandlers("p", "node:d1", DEPS);
    const { ctx } = makeCtx();
    const out = await handlers["i18n.t"]({ key: "a.b", params: { n: 1 } }, ctx);
    expect(DEPS.translate).toHaveBeenCalledWith("a.b", { n: 1 });
    expect(out).toBe("t:a.b");
  });

  it("notify raises an info toast", async () => {
    const { handlers } = buildPluginHandlers("p", "node:d1", DEPS);
    const { ctx } = makeCtx();
    expect(await handlers.notify({ message: "hi" }, ctx)).toEqual({ ok: true });
    expect(pluginNotify).toHaveBeenCalledWith("hi", "info");
  });

  it("notification.publish maps severity onto a toast status", async () => {
    const { handlers } = buildPluginHandlers("p", "node:d1", DEPS);
    const { ctx } = makeCtx();
    await handlers["notification.publish"](
      { channelId: "alerts", severity: "critical", title: "Boom" },
      ctx,
    );
    expect(pluginNotify).toHaveBeenCalledWith("Boom", "error");
  });

  it("mission.read returns a copy that cannot mutate store state", async () => {
    const { handlers } = buildPluginHandlers("p", "node:d1", DEPS);
    const { ctx } = makeCtx();
    const read = (await handlers["mission.read"]({}, ctx)) as {
      waypoints: Array<{ id: string }>;
      progress: number;
      currentWaypoint: number;
    };
    expect(read.waypoints).toEqual(missionState.waypoints);
    expect(read.waypoints).not.toBe(missionState.waypoints);
    expect(read.progress).toBe(0.5);
    expect(read.currentWaypoint).toBe(1);
    // Mutating the returned copy must not touch the store.
    read.waypoints.push({ id: "injected" });
    expect(missionState.waypoints).toHaveLength(1);
  });

  it("recording runs in the plugin's own slot, never the operator's flight recording", async () => {
    const { handlers } = buildPluginHandlers("p", "node:d1", DEPS);
    const { ctx } = makeCtx();
    const slot = "plugin:p:node:d1";

    const started = await handlers["recording.start"]({ name: "flight A" }, ctx);
    expect(startMirrorRecording).toHaveBeenCalledWith(slot, "node:d1", expect.any(String));
    expect(started).toEqual({ ok: true, recordingId: "rec-1" });

    // While the plugin's recording runs, marks land on it.
    vi.mocked(isRecordingFor).mockImplementation((id: string) => id === slot);
    const marked = await handlers["recording.mark"](
      { label: "event", meta: { k: 1 } },
      ctx,
    );
    expect(markRecording).toHaveBeenCalledWith(slot, "event", { k: 1 });
    expect(marked).toEqual({ ok: true });

    const stopped = await handlers["recording.stop"]({}, ctx);
    expect(stopRecordingFor).toHaveBeenCalledWith(slot);
    expect(stopRecordingFor).not.toHaveBeenCalledWith("node:d1");
    expect(stopped).toEqual({ ok: true, recording: { id: "rec-1" } });
  });

  it("refuses a second start while the plugin's recording runs", async () => {
    vi.mocked(isRecordingFor).mockReturnValue(true);
    const { handlers } = buildPluginHandlers("p", "node:d1", DEPS);
    const out = await handlers["recording.start"]({}, makeCtx().ctx);
    expect(out).toEqual({ ok: false, error: "already recording" });
    expect(startMirrorRecording).not.toHaveBeenCalled();
  });

  it("recording.mark reports not-recording when nothing is active", async () => {
    vi.mocked(markRecording).mockReturnValueOnce(false);
    const { handlers } = buildPluginHandlers("p", "node:d1", DEPS);
    const { ctx } = makeCtx();
    const out = await handlers["recording.mark"]({ label: "x" }, ctx);
    expect(out).toEqual({ ok: false, error: "not recording" });
  });

  it("telemetry.subscribe wires the protocol callback and forwards frames", async () => {
    let captured: ((data: unknown) => void) | null = null;
    const unsub = vi.fn();
    const protocol = {
      onAttitude: vi.fn((cb: (d: unknown) => void) => {
        captured = cb;
        return unsub;
      }),
      getSelectedProtocol: undefined,
    };
    droneManagerState = {
      drones: new Map([["node:d1", { protocol }]]),
      getSelectedProtocol: () => protocol,
    };

    const { handlers, dispose } = buildPluginHandlers("p", "node:d1", DEPS);
    const { ctx, postEvent } = makeCtx("telemetry.subscribe.mavlink.attitude");

    const ack = await handlers["telemetry.subscribe"](
      { topic: "mavlink.attitude" },
      ctx,
    );
    expect(ack).toEqual({ ok: true });
    expect(protocol.onAttitude).toHaveBeenCalledTimes(1);
    expect(captured).toBeTypeOf("function");

    // A telemetry frame flows out as a host event on telemetry.<topic>.
    captured!({ roll: 0.1 });
    expect(postEvent).toHaveBeenCalledWith(
      "telemetry.mavlink.attitude",
      "telemetry.subscribe.mavlink.attitude",
      { roll: 0.1 },
    );

    // Explicit unsubscribe drops the subscription.
    await handlers["telemetry.unsubscribe"]({ topic: "mavlink.attitude" }, ctx);
    expect(unsub).toHaveBeenCalledTimes(1);

    // dispose() is idempotent and safe after an explicit unsubscribe.
    dispose();
    expect(unsub).toHaveBeenCalledTimes(1);
  });

  it("telemetry.subscribe rejects an unknown topic", async () => {
    droneManagerState = {
      drones: new Map(),
      getSelectedProtocol: () => ({}),
    };
    const { handlers } = buildPluginHandlers("p", "node:d1", DEPS);
    const { ctx } = makeCtx("telemetry.subscribe.bogus");
    // The handler throws synchronously; the bridge's `await handler()` turns
    // that into a handler_error response.
    expect(() => handlers["telemetry.subscribe"]({ topic: "bogus" }, ctx)).toThrow(
      /unknown telemetry topic/,
    );
  });

  it("dispose tears down an active telemetry subscription", async () => {
    const unsub = vi.fn();
    const protocol = { onBattery: vi.fn(() => unsub) };
    droneManagerState = {
      drones: new Map([["node:d1", { protocol }]]),
      getSelectedProtocol: () => protocol,
    };
    const { handlers, dispose } = buildPluginHandlers("p", "node:d1", DEPS);
    const { ctx } = makeCtx("telemetry.subscribe.battery");
    await handlers["telemetry.subscribe"]({ topic: "battery" }, ctx);
    dispose();
    expect(unsub).toHaveBeenCalledTimes(1);
  });

  it("the control / event / cloud methods are now wired", () => {
    const { handlers } = buildPluginHandlers("p", "node:d1", DEPS);
    // Adversarial coverage for each gate lives in handlers-control.test.ts;
    // here we only assert the surface is registered (it was previously unwired).
    expect(handlers["command.send"]).toBeTypeOf("function");
    expect(handlers["mission.write"]).toBeTypeOf("function");
    expect(handlers["events.subscribe"]).toBeTypeOf("function");
    expect(handlers["events.unsubscribe"]).toBeTypeOf("function");
    expect(handlers["events.publish"]).toBeTypeOf("function");
    expect(handlers["cloud.read"]).toBeTypeOf("function");
    expect(handlers["cloud.write"]).toBeTypeOf("function");
  });
});
