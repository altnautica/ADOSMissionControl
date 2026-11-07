/**
 * @module input/pilot-stream
 * @description The operator's link to the drone's flight pilot: one
 * `WS /api/v1/pilot/stream` per selected agent-connected drone (ticket scope
 * `pilot.control`). It carries stick `input` frames at 50 Hz, `release` when
 * the sticks stop, flight `action`s and the stick-session handover, and it
 * receives the pilot's state. Frames are the `pilot.v1` request objects,
 * JSON-encoded. The pairing key never reaches the URL.
 * @license GPL-3.0-only
 */

import { create } from "zustand";

import { WS_TICKET_PROTOCOL, mintWsTicket } from "@/lib/api/ground-station/ws-ticket";
import type { RequestContext } from "@/lib/api/ground-station/request";
import { openReconnectingSocket } from "@/lib/net/reconnecting-socket";

/** Stick frame rate on the pilot stream (C4). */
export const PILOT_INPUT_HZ = 50;
export const PILOT_INPUT_PERIOD_MS = 1000 / PILOT_INPUT_HZ;
/** A pad whose own timestamp has not advanced for this long stops streaming (C4). */
export const PAD_STALE_MS = 150;
/** The `src` this surface names itself with. */
export const PILOT_SRC = "mc";

/** Every action name `pilot.v1` accepts. */
export type PilotControlMode = "ados" | "fc_manual" | "elrs";

export type PilotActionName =
  | "pause"
  | "resume"
  | "take_control"
  | "hand_to_fc"
  | "launch"
  | "takeoff"
  | "land"
  | "rth"
  | "arm"
  | "disarm"
  | "kill"
  | `profile:${"cine" | "normal" | "sport"}`
  | `control_mode:${"ados" | "fc_manual" | "elrs"}`
  | `avoid:${"brake" | "bypass" | "off"}`
  | "rth_cancel"
  | `vtol:${"fw" | "mc"}`;

/** Server reply to an action, when the pilot sends one. */
export interface PilotActionResult {
  name: string;
  ok: boolean;
  err?: string;
  at: number;
}

export type PilotOutboundFrame =
  | {
      op: "input";
      src: string;
      session: string;
      seq: number;
      t_ms: number;
      axes: [number, number, number, number];
      buttons: number;
    }
  | { op: "release"; src: string; session: string }
  | { op: "action"; name: PilotActionName; src: string; args?: Record<string, unknown> }
  | { op: "session.take"; src: string; session: string }
  | { op: "hb"; src: string };

/** One page load is one stick session. */
function newSessionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `mc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export const PILOT_SESSION_ID = newSessionId();

interface PilotLinkState {
  /** Drone the open stream belongs to, or null. */
  droneId: string | null;
  connected: boolean;
  /** True while this surface is streaming sticks (not released). */
  streaming: boolean;
  /** Frames sent since the stream opened (tests and the controls screen read it). */
  framesSent: number;
  lastAction: PilotActionResult | null;
  /** The drone's `control.mode` as the pilot last reported it. */
  controlMode: PilotControlMode | null;
  /** Raw pilot state the stream pushed, handed to `onPilotState` subscribers. */
  set: (patch: Partial<Omit<PilotLinkState, "set">>) => void;
}

export const usePilotLinkStore = create<PilotLinkState>((set) => ({
  droneId: null,
  connected: false,
  streaming: false,
  framesSent: 0,
  lastAction: null,
  controlMode: null,
  set: (patch) => set(patch),
}));

type Sender = (frame: PilotOutboundFrame) => boolean;

let sender: Sender | null = null;
let seq = 0;
const stateListeners = new Set<(droneId: string, data: unknown) => void>();

/** Subscribe to pilot state frames received on the stream. */
export function onPilotState(fn: (droneId: string, data: unknown) => void): () => void {
  stateListeners.add(fn);
  return () => stateListeners.delete(fn);
}

/** Install a frame sender directly (tests, demo mode). */
export function setPilotSender(next: Sender | null, droneId: string | null = null): void {
  sender = next;
  usePilotLinkStore.getState().set({ droneId, connected: next !== null, streaming: false });
}

/** Whether a pilot stream is open for `droneId`. */
export function pilotStreamOpen(droneId: string | null | undefined): boolean {
  const s = usePilotLinkStore.getState();
  return !!droneId && s.connected && s.droneId === droneId && sender !== null;
}

/**
 * Whether `droneId` is flown by its ADOS pilot from this surface: an open
 * pilot stream and `control.mode == ados`. Sticks and built-ins then go to the
 * pilot instead of the flight controller.
 */
export function sticksRouteToPilot(droneId: string | null | undefined): boolean {
  return pilotStreamOpen(droneId) && usePilotLinkStore.getState().controlMode === "ados";
}

function send(frame: PilotOutboundFrame): boolean {
  if (!sender) return false;
  const ok = sender(frame);
  if (ok) {
    const s = usePilotLinkStore.getState();
    s.set({ framesSent: s.framesSent + 1 });
  }
  return ok;
}

/** Send one stick frame. `axes` already carry deadzone and mode mapping. */
export function sendPilotInput(axes: [number, number, number, number], buttons: number): boolean {
  seq = (seq + 1) >>> 0;
  const ok = send({
    op: "input",
    src: PILOT_SRC,
    session: PILOT_SESSION_ID,
    seq,
    t_ms: Date.now(),
    axes,
    buttons,
  });
  if (ok && !usePilotLinkStore.getState().streaming) {
    usePilotLinkStore.getState().set({ streaming: true });
  }
  return ok;
}

/** Stop the sticks: the pilot brakes to a hold. Sent once per stop. */
export function sendPilotRelease(): boolean {
  if (!usePilotLinkStore.getState().streaming) return false;
  usePilotLinkStore.getState().set({ streaming: false });
  return send({ op: "release", src: PILOT_SRC, session: PILOT_SESSION_ID });
}

/** Send a flight action. Returns false when no stream is open. */
export function sendPilotAction(name: PilotActionName, args?: Record<string, unknown>): boolean {
  return send(args ? { op: "action", name, src: PILOT_SRC, args } : { op: "action", name, src: PILOT_SRC });
}

/** Take the stick session from another surface. */
export function takePilotSession(): boolean {
  return send({ op: "session.take", src: PILOT_SRC, session: PILOT_SESSION_ID });
}

/** Route one server frame. Exported for tests. */
export function handlePilotServerFrame(droneId: string, frame: unknown): void {
  if (typeof frame !== "object" || frame === null) return;
  const f = frame as Record<string, unknown>;
  if (f.kind === "pilot") {
    const mode = (f.data as Record<string, unknown> | null)?.control_mode;
    if (mode === "ados" || mode === "fc_manual" || mode === "elrs") {
      if (usePilotLinkStore.getState().controlMode !== mode) {
        usePilotLinkStore.getState().set({ controlMode: mode });
      }
    }
    for (const fn of stateListeners) fn(droneId, f.data);
  } else if (f.kind === "action_result" && typeof f.name === "string") {
    usePilotLinkStore.getState().set({
      lastAction: {
        name: f.name,
        ok: f.ok === true,
        ...(typeof f.err === "string" ? { err: f.err } : {}),
        at: Date.now(),
      },
    });
  }
}

export interface PilotStreamConnection {
  close: () => void;
}

/** Open the pilot stream for one drone. Closing releases the sticks first. */
export function connectPilotStream(opts: {
  droneId: string;
  agentUrl: string;
  apiKey: string | null;
}): PilotStreamConnection {
  const { droneId, agentUrl, apiKey } = opts;
  if (typeof window === "undefined" || !agentUrl) return { close: () => {} };
  const ctx: RequestContext = { baseUrl: agentUrl, apiKey };
  const url = agentUrl.replace(/^http/, "ws") + "/api/v1/pilot/stream";
  let socket: WebSocket | null = null;
  // While not streaming sticks, a 1 Hz heartbeat keeps the pilot's link-loss
  // failsafe from counting this surface as gone.
  const hb = setInterval(() => {
    if (!usePilotLinkStore.getState().streaming) send({ op: "hb", src: PILOT_SRC });
  }, 1000);

  const teardown = openReconnectingSocket<WebSocket>({
    open: async (signal) => {
      const ticket = await mintWsTicket(ctx, "pilot.control", signal);
      const ws = ticket ? new WebSocket(url, [WS_TICKET_PROTOCOL, ticket]) : new WebSocket(url);
      socket = ws;
      return ws;
    },
    onMessage: (data) => {
      let frame: unknown;
      try {
        frame = JSON.parse(String(data));
      } catch {
        return;
      }
      handlePilotServerFrame(droneId, frame);
    },
    onState: (state) => {
      const live = state === "connected";
      sender = live
        ? (frame) => {
            if (!socket || socket.readyState !== WebSocket.OPEN) return false;
            socket.send(JSON.stringify(frame));
            return true;
          }
        : null;
      usePilotLinkStore.getState().set({
        droneId: live ? droneId : null,
        connected: live,
        ...(live ? {} : { streaming: false }),
      });
    },
  });

  return {
    close: () => {
      sendPilotRelease();
      sender = null;
      usePilotLinkStore.getState().set({ droneId: null, connected: false, streaming: false });
      clearInterval(hb);
      teardown();
      socket = null;
    },
  };
}
