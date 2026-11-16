/**
 * A plugin's `command.send takeoff` for an armed drone with a live pilot on
 * the stream goes out, once the operator approves it, as the pilot's
 * `launch {after: "hold", alt_m}`; without a pilot it stays NAV_TAKEOFF.
 * A take-off while the drone is not known armed is refused before the
 * prompt on every route, so a plugin never arms the drone.
 *
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sendCommand, fc } = vi.hoisted(() => ({
  sendCommand: vi.fn(async () => ({ success: true })),
  fc: { armState: "armed" },
}));
vi.mock("@/stores/drone-manager", () => ({
  useDroneManager: {
    getState: () => ({ drones: new Map([["node:d1", { protocol: { sendCommand } }]]) }),
  },
}));
vi.mock("@/stores/node-registry", () => ({
  useNodeRegistryStore: {
    getState: () => ({
      getEntry: (id: string) =>
        id === "node:d1" ? { fc, connection: { fcConnected: true } } : undefined,
    }),
  },
}));

import { buildControlHandlers } from "../control";
import { refusalText } from "@/lib/hud/refusal";
import { resetCommandRateLimits } from "../command-rate";
import type { BridgeHandlerContext } from "@/lib/plugins/bridge";
import { setPluginConfirmHandler } from "@/lib/plugins/confirm";
import { handlePilotServerFrame, setPilotSender, usePilotLinkStore } from "@/lib/input/pilot-stream";
import { useNavStreamStore } from "@/stores/nav-stream-store";

let sent: Array<{ name: string; args?: Record<string, unknown> }> = [];

function takeoff(alt: number) {
  return buildControlHandlers("com.example.p", { nodeId: "node:d1", deviceId: "d1" })["command.send"](
    { command: "takeoff", args: { alt } },
    {} as BridgeHandlerContext,
  );
}

describe("plugin take-off with a pilot", () => {
  beforeEach(() => {
    sent = [];
    sendCommand.mockClear();
    resetCommandRateLimits();
    fc.armState = "armed";
    setPluginConfirmHandler(async () => true);
  });
  afterEach(() => {
    setPilotSender(null);
    useNavStreamStore.setState({ byDrone: {} });
  });

  function withPilot() {
    setPilotSender(((f: { op: string; name: string; id: string; args?: Record<string, unknown> }) => {
      if (f.op !== "action") return true;
      sent.push({ name: f.name, args: f.args });
      queueMicrotask(() => handlePilotServerFrame("node:d1", { kind: "action_result", name: f.name, id: f.id, ok: true }));
      return true;
    }) as never, "node:d1");
    usePilotLinkStore.getState().set({ controlMode: "fc_manual" });
    useNavStreamStore.setState({ byDrone: { "node:d1": { pilot: { data: null, receivedAt: Date.now() } } } as never });
  }

  it("refuses a take-off while the drone is not known armed, before the prompt, on any route", async () => {
    for (const armState of ["disarmed", "unknown"]) {
      for (const pilot of [true, false]) {
        if (pilot) withPilot();
        fc.armState = armState;
        let prompted = false;
        setPluginConfirmHandler(async () => {
          prompted = true;
          return true;
        });
        const res = await takeoff(12);
        expect(res).toEqual({ ok: false, error: refusalText("disarmed") });
        expect(prompted).toBe(false);
        expect(sent).toEqual([]);
        expect(sendCommand).not.toHaveBeenCalled();
        setPilotSender(null);
        useNavStreamStore.setState({ byDrone: {} });
      }
    }
  });

  it("sends the pilot's launch for an armed drone after the operator approves", async () => {
    withPilot();
    const res = await takeoff(12);
    expect(res).toMatchObject({ ok: true });
    expect(sent).toEqual([{ name: "launch", args: { after: "hold", alt_m: 12 } }]);
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it("sends nothing when the operator declines", async () => {
    setPilotSender((() => true) as never, "node:d1");
    useNavStreamStore.setState({ byDrone: { "node:d1": { pilot: { data: null, receivedAt: Date.now() } } } as never });
    setPluginConfirmHandler(async () => false);
    const res = await takeoff(12);
    expect(res).toMatchObject({ ok: false });
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it("stays NAV_TAKEOFF without a pilot", async () => {
    const res = await takeoff(12);
    expect(res).toMatchObject({ ok: true });
    expect(sendCommand).toHaveBeenCalledWith(22, [0, 0, 0, 0, 0, 0, 12]);
  });
});
