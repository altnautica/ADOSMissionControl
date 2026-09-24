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
  pluginNotify: vi.fn(() => true),
}));

let droneManagerState: {
  drones: Map<string, { protocol: unknown }>;
  getSelectedProtocol: () => unknown;
};

const droneManagerListeners = new Set<() => void>();

/** Replace the drone manager state and notify subscribers, like a store set. */
function setDroneManager(next: typeof droneManagerState): void {
  droneManagerState = next;
  for (const listener of droneManagerListeners) listener();
}

vi.mock("@/stores/drone-manager", () => ({
  useDroneManager: {
    getState: () => droneManagerState,
    subscribe: (listener: () => void) => {
      droneManagerListeners.add(listener);
      return () => droneManagerListeners.delete(listener);
    },
  },
}));

import { buildPluginHandlers } from "@/lib/plugins/handlers";
import { testMount } from "@/lib/plugins/handlers/__tests__/test-mount";
import { pluginNotify } from "@/lib/plugins/notifier";
import { agentStateOrigin, publishPluginEvent } from "@/lib/plugins/event-bus";
import {
  startMirrorRecording,
  stopRecordingFor,
  markRecording,
  isRecordingFor,
} from "@/lib/telemetry-recorder";

let mount = testMount();

function makeCtx(capability: string | null = null): {
  ctx: BridgeHandlerContext;
  postEvent: ReturnType<typeof vi.fn>;
} {
  const postEvent = vi.fn();
  return {
    ctx: { pluginId: "com.example.plug", capability, postEvent, mount, claims: null },
    postEvent,
  };
}

const DEPS = { translate: vi.fn((key: string) => `t:${key}`) };

beforeEach(() => {
  vi.clearAllMocks();
  mount = testMount();
  droneManagerListeners.clear();
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
    expect(pluginNotify).toHaveBeenCalledWith("p", "hi", "info");
  });

  it("notification.publish maps severity onto a toast status", async () => {
    const { handlers } = buildPluginHandlers("p", "node:d1", DEPS);
    const { ctx } = makeCtx();
    await handlers["notification.publish"](
      { channelId: "alerts", severity: "critical", title: "Boom" },
      ctx,
    );
    expect(pluginNotify).toHaveBeenCalledWith("p", "Boom", "error");
  });

  it("notification.publish shows the SDK body with its title", async () => {
    const { handlers } = buildPluginHandlers("p", "node:d1", DEPS);
    const { ctx } = makeCtx();
    await handlers["notification.publish"](
      { severity: "warning", title: "Cell imbalance", body: "Cell 3 is 180 mV low" },
      ctx,
    );
    expect(pluginNotify).toHaveBeenCalledWith(
      "p",
      "Cell imbalance: Cell 3 is 180 mV low",
      "warning",
    );
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
    expect(ack).toEqual({ ok: true, linked: true });
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

  it("telemetry.subscribe rejects an unknown topic for a plugin with no drone", async () => {
    droneManagerState = {
      drones: new Map(),
      getSelectedProtocol: () => ({}),
    };
    const { handlers } = buildPluginHandlers("p", null, DEPS);
    const { ctx } = makeCtx("telemetry.subscribe.bogus");
    // The handler throws synchronously; the bridge's `await handler()` turns
    // that into a handler_error response.
    expect(() => handlers["telemetry.subscribe"]({ topic: "bogus" }, ctx)).toThrow(
      /unknown telemetry topic/,
    );
  });

  it("serves the plugin's own agent-extended channel from its drone only", async () => {
    const { handlers } = buildPluginHandlers("com.example.pod", "node:d1", DEPS);
    const { ctx, postEvent } = makeCtx("telemetry.subscribe.siyi");
    expect(await handlers["telemetry.subscribe"]({ topic: "siyi" }, ctx)).toEqual({ ok: true });

    publishPluginEvent("telemetry.siyi", { zoom: 2 }, agentStateOrigin("com.example.pod", "d1"));
    publishPluginEvent("telemetry.siyi", { zoom: 9 }, agentStateOrigin("com.example.other", "d1"));
    publishPluginEvent("telemetry.siyi", { zoom: 7 }, agentStateOrigin("com.example.pod", "d2"));

    expect(postEvent).toHaveBeenCalledTimes(1);
    expect(postEvent).toHaveBeenCalledWith("telemetry.siyi", "telemetry.subscribe.siyi", { zoom: 2 });
  });

  it("re-attaches telemetry to the new adapter after a reconnect and announces the link", async () => {
    const emitters: Array<(d: unknown) => void> = [];
    const makeProtocol = () => ({
      onBattery: vi.fn((cb: (d: unknown) => void) => {
        emitters.push(cb);
        return vi.fn();
      }),
    });
    const first = makeProtocol();
    setDroneManager({ drones: new Map([["node:d1", { protocol: first }]]), getSelectedProtocol: () => null });
    const { handlers, dispose } = buildPluginHandlers("p", "node:d1", DEPS);
    const { ctx, postEvent } = makeCtx("telemetry.subscribe.mavlink.battery");
    await handlers["telemetry.subscribe"]({ topic: "mavlink.battery" }, ctx);

    // The link drops: the plugin is told, so it can decay its display.
    setDroneManager({ drones: new Map(), getSelectedProtocol: () => null });
    expect(postEvent).toHaveBeenLastCalledWith("telemetry.link", "", { connected: false });

    // The reconnect adds a new adapter: the subscription follows it.
    const second = makeProtocol();
    setDroneManager({ drones: new Map([["node:d1", { protocol: second }]]), getSelectedProtocol: () => null });
    expect(second.onBattery).toHaveBeenCalledTimes(1);
    expect(postEvent).toHaveBeenLastCalledWith("telemetry.link", "", { connected: true });
    emitters[1]({ voltage: 12 });
    expect(postEvent).toHaveBeenLastCalledWith(
      "telemetry.mavlink.battery",
      "telemetry.subscribe.mavlink.battery",
      { voltage: 12 },
    );
    dispose();
  });

  it("holds a subscribe made before the link exists and attaches when it appears", async () => {
    setDroneManager({ drones: new Map(), getSelectedProtocol: () => null });
    const { handlers, dispose } = buildPluginHandlers("p", "node:d1", DEPS);
    const { ctx } = makeCtx("telemetry.subscribe.mavlink.attitude");
    const ack = await handlers["telemetry.subscribe"]({ topic: "mavlink.attitude" }, ctx);
    expect(ack).toEqual({ ok: true, linked: false });

    const protocol = { onAttitude: vi.fn(() => vi.fn()) };
    setDroneManager({ drones: new Map([["node:d1", { protocol }]]), getSelectedProtocol: () => null });
    expect(protocol.onAttitude).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("keeps one subscription per iframe when two panels subscribe to the same topic", async () => {
    const unsubs = [vi.fn(), vi.fn()];
    let n = 0;
    const protocol = { onBattery: vi.fn(() => unsubs[n++]) };
    setDroneManager({ drones: new Map([["node:d1", { protocol }]]), getSelectedProtocol: () => null });
    const { handlers, dispose } = buildPluginHandlers("p", "node:d1", DEPS);
    const panelA = { ...makeCtx("telemetry.subscribe.battery").ctx, mount: testMount() };
    const panelB = { ...makeCtx("telemetry.subscribe.battery").ctx, mount: testMount() };
    await handlers["telemetry.subscribe"]({ topic: "battery" }, panelA);
    await handlers["telemetry.subscribe"]({ topic: "battery" }, panelB);
    // Panel B's subscribe did not tear down panel A's.
    expect(unsubs[0]).not.toHaveBeenCalled();

    // Unmounting panel A releases only its own subscription.
    panelA.mount.dispose();
    expect(unsubs[0]).toHaveBeenCalledTimes(1);
    expect(unsubs[1]).not.toHaveBeenCalled();
    dispose();
    expect(unsubs[1]).toHaveBeenCalledTimes(1);
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
    expect(handlers["cloud.write"]).toBeUndefined();
  });
});
