/**
 * @license GPL-3.0-only
 *
 * The pilot stream names this tab's instance: every frame carries the tab's
 * `sid`, the same across a reconnect, so the pilot keeps one link-loss timer
 * per tab. A deliberate close (the bridge unmounting, a drone switch, the tab
 * going away) says `bye` first. With no RC transmitter declared and the drone
 * armed, a leave ends in the pilot's link-loss action unless another surface
 * holds the sticks, so closing the tab and switching the drone ask first.
 */

import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

vi.mock("@/lib/api/ground-station/ws-ticket", () => ({
  WS_TICKET_PROTOCOL: "ados.ticket",
  mintWsTicket: async () => null,
}));

import {
  PILOT_SESSION_ID,
  PILOT_SID,
  connectPilotStream,
  handlePilotServerFrame,
  pilotLeaveWarning,
  sendPilotAction,
  sendPilotInput,
  sendPilotRelease,
  setPilotSender,
  takePilotSession,
  usePilotLinkStore,
  type PilotStreamConnection,
} from "../pilot-stream";
import { specText } from "@/lib/hud/spec-text";
import { useDroneManager } from "@/stores/drone-manager";

class FakeSocket {
  static readonly OPEN = 1;
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  close(): void {
    this.readyState = 3;
  }
  accept(): void {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.(new Event("open"));
  }
  drop(): void {
    this.readyState = 3;
    this.onclose?.({ code: 1006, reason: "" } as CloseEvent);
  }
}

const DRONE = "drone-norc";
let conn: PilotStreamConnection | null = null;

/** Open the stream and let its first socket connect. */
async function open(): Promise<FakeSocket> {
  conn = connectPilotStream({ droneId: DRONE, agentUrl: "http://agent.test", apiKey: null });
  await vi.advanceTimersByTimeAsync(0);
  const ws = FakeSocket.all.at(-1)!;
  ws.accept();
  return ws;
}

function pilotState(data: Record<string, unknown>): void {
  handlePilotServerFrame(DRONE, { kind: "pilot", data: { owner: "pilot", control_mode: "ados", ...data } });
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.all = [];
  vi.stubGlobal("WebSocket", FakeSocket);
});

afterEach(() => {
  conn?.close();
  conn = null;
  setPilotSender(null);
  usePilotLinkStore.getState().set({ streaming: false, framesSent: 0, agentFor: null, controlMode: null });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("the tab's sid", () => {
  it("is 32 lowercase hex", () => {
    expect(PILOT_SID).toMatch(/^[0-9a-f]{32}$/);
  });

  it("rides on every frame and stays the same across a reconnect", async () => {
    const first = await open();
    sendPilotInput([0, 0.5, 0, 0], 0);
    sendPilotRelease();
    takePilotSession();
    sendPilotAction("pause");
    await vi.advanceTimersByTimeAsync(1000);
    expect(first.sent.map((f) => f.op)).toEqual(["input", "release", "session.take", "action", "hb"]);

    first.drop();
    await vi.advanceTimersByTimeAsync(3000);
    const second = FakeSocket.all.at(-1)!;
    expect(second).not.toBe(first);
    second.accept();
    sendPilotAction("land");
    await vi.advanceTimersByTimeAsync(1000);
    expect(second.sent.map((f) => f.op)).toEqual(["action", "hb"]);

    const frames = [...first.sent, ...second.sent];
    for (const f of frames) expect(f.sid).toBe(PILOT_SID);
  });
});

describe("bye", () => {
  it("a deliberate close releases the sticks and says bye before the socket goes", async () => {
    const ws = await open();
    sendPilotInput([0, 0, 0, 0], 0);
    conn!.close();
    conn = null;
    expect(ws.sent.slice(-2)).toEqual([
      { op: "release", src: "mc", sid: PILOT_SID, session: PILOT_SESSION_ID },
      { op: "bye", src: "mc", sid: PILOT_SID },
    ]);
  });

  it("the tab going away says bye", async () => {
    const ws = await open();
    window.dispatchEvent(new Event("pagehide"));
    expect(ws.sent.at(-1)).toEqual({ op: "bye", src: "mc", sid: PILOT_SID });
  });
});

describe("leaving with no RC", () => {
  const leave = specText("shell.leave_no_rc", { action: specText("pilot.link_loss_action.rth"), s: 10 });

  it("warns while armed with no RC, unless another surface holds the sticks", async () => {
    await open();
    const self = { src: "mc", session: PILOT_SESSION_ID, label: "Mission Control" };
    pilotState({ armed: true, rc_receiver: "absent", input_session: self });
    expect(pilotLeaveWarning()).toBe(leave);
    pilotState({ armed: true, rc_receiver: "absent", input_session: null });
    expect(pilotLeaveWarning()).toBe(leave);
    pilotState({ armed: true, rc_receiver: "absent", input_session: { src: "android", session: 9, label: "Phone" } });
    expect(pilotLeaveWarning()).toBeNull();
    pilotState({ armed: false, rc_receiver: "absent" });
    expect(pilotLeaveWarning()).toBeNull();
    pilotState({ armed: true });
    expect(pilotLeaveWarning()).toBeNull();
  });

  it("names the pilot's own link-loss action and window", async () => {
    await open();
    pilotState({ armed: true, rc_receiver: "absent", link_loss_action: "land", link_loss_s: 12 });
    expect(pilotLeaveWarning()).toBe(specText("shell.leave_no_rc", { action: specText("pilot.link_loss_action.land"), s: 12 }));
  });

  it("closing the tab asks first", async () => {
    await open();
    const quiet = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(quiet);
    expect(quiet.defaultPrevented).toBe(false);
    pilotState({ armed: true, rc_receiver: "absent" });
    const warned = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(warned);
    expect(warned.defaultPrevented).toBe(true);
  });

  it("switching the drone asks first, and a cancel keeps the drone and its stream", async () => {
    useDroneManager.setState({ selectedDroneId: DRONE });
    const ws = await open();
    pilotState({ armed: true, rc_receiver: "absent" });
    // happy-dom has no `window.confirm`: install one for this test.
    const confirm = vi.fn<(message?: string) => boolean>(() => false);
    const original = window.confirm;
    window.confirm = confirm;
    onTestFinished(() => {
      window.confirm = original;
    });
    useDroneManager.getState().selectDrone("drone-other");
    expect(confirm).toHaveBeenCalledWith(leave);
    expect(useDroneManager.getState().selectedDroneId).toBe(DRONE);
    expect(ws.sent.some((f) => f.op === "bye")).toBe(false);
    confirm.mockReturnValue(true);
    useDroneManager.getState().selectDrone("drone-other");
    expect(useDroneManager.getState().selectedDroneId).toBe("drone-other");
    useDroneManager.setState({ selectedDroneId: null });
  });
});
