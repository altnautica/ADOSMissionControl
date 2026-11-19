/**
 * @module input/pilot-stream
 * @description The operator's link to the drone's flight pilot: one
 * `WS /api/v1/pilot/stream` per selected agent-connected drone (ticket scope
 * `pilot.control`). It carries stick `input` frames at 50 Hz, `release` when
 * the sticks stop, flight `action`s and the stick-session handover, and it
 * receives the pilot's state. Frames are the `pilot.v1` request objects,
 * JSON-encoded. The pairing key never reaches the URL.
 *
 * Every frame carries this tab's `sid`, so the pilot runs one link-loss timer
 * per tab across reconnects; `bye` precedes a deliberate close; the 1 Hz `hb`
 * is timed by a Worker (see pilot-hb). With no RC transmitter declared and
 * the drone armed, leaving the stream ends in the pilot's link-loss action
 * unless another surface holds the sticks, so a leave is warned first.
 * @license GPL-3.0-only
 */

import { create } from "zustand";

import { WS_TICKET_PROTOCOL, mintWsTicket } from "@/lib/api/ground-station/ws-ticket";
import type { RequestContext } from "@/lib/api/ground-station/request";
import { openReconnectingSocket } from "@/lib/net/reconnecting-socket";
import { noRcLeaveText } from "@/lib/cockpit/no-rc-text";
import { startPilotHeartbeat, type PilotHeartbeat } from "./pilot-hb";
import { coalescingSender } from "./pilot-coalesce";
import { newSessionId, newSurfaceSid } from "./pilot-ids";

/** Stick frame rate on the pilot stream. */
export const PILOT_INPUT_HZ = 50;
export const PILOT_INPUT_PERIOD_MS = 1000 / PILOT_INPUT_HZ;
/** A pad whose own timestamp has not advanced for this long stops streaming. */
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
  | "mission_skip"
  | "goto"
  | "airframe_reset"
  | `vtol:${"fw" | "mc"}`
  | `place_class:${"open" | "confined"}`
  | `rc_receiver:${"absent" | "present"}`;

/** Server reply to an action, when the pilot sends one. */
export interface PilotActionResult {
  name: string;
  id?: string;
  ok: boolean;
  err?: string;
  at: number;
}

/** Every client frame names this tab's instance (`sid`). */
export type PilotOutboundFrame =
  | {
      op: "input";
      src: string;
      sid: string;
      session: number;
      seq: number;
      t_ms: number;
      axes: [number, number, number, number];
      buttons: number;
    }
  | { op: "release"; src: string; sid: string; session: number }
  | { op: "action"; name: PilotActionName; src: string; sid: string; id: string; args?: Record<string, unknown> }
  | { op: "session.take"; src: string; sid: string; session: number }
  | { op: "hb"; src: string; sid: string }
  | { op: "bye"; src: string; sid: string };

/** One page load is one stick session (a non-zero u32 in `pilot.v1`). */
export const PILOT_SESSION_ID = newSessionId();

/**
 * This tab's instance id, once per page load and kept in memory only (a
 * duplicated tab or a reload is a new instance). Every frame carries it, and
 * a reconnect keeps it, so the pilot's link-loss timer for this tab runs on
 * across the reconnect.
 */
export const PILOT_SID = newSurfaceSid();

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
  /** The drone this surface reaches through its agent (the bridge holds a
   * pilot stream for it, open or reconnecting), or null for a direct link. */
  agentFor: string | null;
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
  agentFor: null,
  set: (patch) => set(patch),
}));

type Sender = (frame: PilotOutboundFrame) => boolean;

let sender: Sender | null = null;
let seq = 0;
const stateListeners = new Set<(droneId: string, data: unknown) => void>();

/** What a deliberate leave depends on, from the last pilot state. */
interface LeaveState {
  /** Null while the pilot has no FC link: possibly airborne. */
  armed: boolean | null;
  rcAbsent: boolean;
  /** The stick session's holder, or null while nobody holds it. */
  session: { src: string; session: number | null } | null;
  linkLossAction: string | null;
  linkLossS: number | null;
}

let leaveState: LeaveState | null = null;
/** The open stream's heartbeat, told whether this tab holds the sticks. */
let heartbeat: PilotHeartbeat | null = null;

/** Whether a stick-session holder is this tab: its session id, or `src` from
 *  a pilot that names no session. */
function isThisTab(holder: { src: string; session: number | null }): boolean {
  return holder.session !== null ? holder.session === PILOT_SESSION_ID : holder.src === PILOT_SRC;
}

/** Whether this tab holds the pilot's stick session. */
export function holdsPilotSession(): boolean {
  const session = leaveState?.session ?? null;
  return session !== null && isThisTab(session);
}

/**
 * The warning a deliberate leave of the pilot stream needs, or null. Armed
 * (or arm state unknown) with no RC transmitter declared, the pilot honours
 * this tab's `bye` only when another surface holds the stick session, so
 * otherwise leaving ends in its link-loss action.
 */
export function pilotLeaveWarning(): string | null {
  const s = leaveState;
  if (!s || !s.rcAbsent || s.armed === false) return null;
  if (s.session !== null && !isThisTab(s.session)) return null;
  return noRcLeaveText(s);
}

/** Ask before an in-app leave of the pilot stream (switching the drone).
 *  True when there is nothing to warn about or the operator confirmed. */
export function confirmPilotLeave(): boolean {
  const text = pilotLeaveWarning();
  if (text === null || typeof window === "undefined") return true;
  return window.confirm(text);
}

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

/**
 * Whether the sticks may go to the flight controller as MANUAL_CONTROL for
 * `droneId`: on a direct link always; on an agent-connected drone only while
 * its pilot reports `control_mode == fc_manual` (in `ados` they go to the
 * pilot, in `elrs` the ground station's radio flies, and while the stream is
 * down nothing is known, so nothing is sent).
 */
export function sticksRouteToFc(droneId: string | null | undefined): boolean {
  const s = usePilotLinkStore.getState();
  if (!droneId || s.agentFor !== droneId) return true;
  return pilotStreamOpen(droneId) && s.controlMode === "fc_manual";
}

/** Send one stick frame. `axes` already carry deadzone and mode mapping. */
export function sendPilotInput(axes: [number, number, number, number], buttons: number): boolean {
  seq = (seq + 1) >>> 0;
  const ok = send({
    op: "input",
    src: PILOT_SRC,
    sid: PILOT_SID,
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
  return send({ op: "release", src: PILOT_SRC, sid: PILOT_SID, session: PILOT_SESSION_ID });
}

/** How long an action waits for the pilot's `action_result`. */
export const PILOT_ACTION_TIMEOUT_MS = 3000;
/** The refusal code an action resolves with when the pilot gave no answer in
 * time. Like the other codes this client makes up (`no pilot link`, `closed`)
 * it reads through the spec's `refusal.*` text. */
export const PILOT_NO_ANSWER = "no response";
/** The refusal code of an action sent with no pilot stream open. */
export const PILOT_NO_LINK = "no pilot link";
/** The refusal code of an action whose stream closed before the answer. */
export const PILOT_CLOSED = "closed";

/** The pilot's answer to one action. */
export interface PilotActionOutcome {
  ok: boolean;
  err?: string;
}

interface PendingAction {
  name: string;
  resolve: (r: PilotActionOutcome) => void;
  timer: ReturnType<typeof setTimeout>;
}

let actionSeq = 0;
const pendingActions = new Map<string, PendingAction>();

function settleAction(id: string, outcome: PilotActionOutcome): void {
  const p = pendingActions.get(id);
  if (!p) return;
  pendingActions.delete(id);
  clearTimeout(p.timer);
  p.resolve(outcome);
}

/** Fail every action still waiting (the stream closed under it). */
function failPendingActions(err: string): void {
  for (const id of [...pendingActions.keys()]) settleAction(id, { ok: false, err });
}

function actionFrame(name: PilotActionName, id: string, args?: Record<string, unknown>): PilotOutboundFrame {
  const frame = { op: "action" as const, name, src: PILOT_SRC, sid: PILOT_SID, id };
  return args ? { ...frame, args } : frame;
}

/** Send a flight action without waiting for its result. Returns false when no
 * stream is open. */
export function sendPilotAction(name: PilotActionName, args?: Record<string, unknown>): boolean {
  actionSeq += 1;
  return send(actionFrame(name, `mc-${actionSeq}`, args));
}

/**
 * Send a flight action and wait for the pilot's `action_result` carrying the
 * same id. A refusal, a closed stream or no answer within
 * {@link PILOT_ACTION_TIMEOUT_MS} resolves `ok: false` with the reason.
 */
export function requestPilotAction(
  name: PilotActionName,
  args?: Record<string, unknown>,
  timeoutMs: number = PILOT_ACTION_TIMEOUT_MS,
): Promise<PilotActionOutcome> {
  actionSeq += 1;
  const id = `mc-${actionSeq}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => settleAction(id, { ok: false, err: PILOT_NO_ANSWER }), timeoutMs);
    pendingActions.set(id, { name, resolve, timer });
    if (!send(actionFrame(name, id, args))) settleAction(id, { ok: false, err: PILOT_NO_LINK });
  });
}

/** One heartbeat: keeps the pilot's link-loss failsafe counting this surface. */
export function sendPilotHeartbeat(): boolean {
  return send({ op: "hb", src: PILOT_SRC, sid: PILOT_SID });
}

/** This tab is leaving the stream on purpose. Best effort: false when no
 *  stream is open. */
export function sendPilotBye(): boolean {
  return send({ op: "bye", src: PILOT_SRC, sid: PILOT_SID });
}

/** Take the stick session from another surface. */
export function takePilotSession(): boolean {
  return send({ op: "session.take", src: PILOT_SRC, sid: PILOT_SID, session: PILOT_SESSION_ID });
}

function readLeaveState(data: Record<string, unknown>): LeaveState {
  const is = data.input_session;
  const holder = typeof is === "object" && is !== null ? (is as Record<string, unknown>) : null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    armed: typeof data.armed === "boolean" ? data.armed : null,
    rcAbsent: data.rc_receiver === "absent",
    session: holder && typeof holder.src === "string" ? { src: holder.src, session: num(holder.session) } : null,
    linkLossAction: typeof data.link_loss_action === "string" ? data.link_loss_action : null,
    linkLossS: num(data.link_loss_s),
  };
}

/** Route one server frame. Exported for tests. */
export function handlePilotServerFrame(droneId: string, frame: unknown): void {
  if (typeof frame !== "object" || frame === null) return;
  const f = frame as Record<string, unknown>;
  if (f.kind === "pilot") {
    const data = typeof f.data === "object" && f.data !== null ? (f.data as Record<string, unknown>) : null;
    const mode = data?.control_mode;
    if (mode === "ados" || mode === "fc_manual" || mode === "elrs") {
      if (usePilotLinkStore.getState().controlMode !== mode) {
        usePilotLinkStore.getState().set({ controlMode: mode });
      }
    }
    if (data) {
      leaveState = readLeaveState(data);
      heartbeat?.setHolder(holdsPilotSession());
    }
    for (const fn of stateListeners) fn(droneId, f.data);
  } else if (f.kind === "action_result" && typeof f.name === "string") {
    const ok = f.ok === true;
    const err = typeof f.err === "string" ? f.err : undefined;
    const id = typeof f.id === "string" ? f.id : undefined;
    usePilotLinkStore.getState().set({
      lastAction: { name: f.name, ...(id ? { id } : {}), ok, ...(err ? { err } : {}), at: Date.now() },
    });
    if (id) settleAction(id, err ? { ok, err } : { ok });
  }
}

export interface PilotStreamConnection {
  close: () => void;
}

/** Open the pilot stream for one drone. Closing releases the sticks and
 *  says `bye` first. */
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
  // failsafe from counting this surface as gone. The Worker times it; see
  // pilot-hb for the send path and the session holder's liveness gate.
  heartbeat?.stop();
  const hb = startPilotHeartbeat(() => {
    if (!usePilotLinkStore.getState().streaming) sendPilotHeartbeat();
  });
  heartbeat = hb;
  hb.setHolder(holdsPilotSession());
  // The tab is going away (closed, reloaded, navigated off): release and say
  // `bye` while the socket is still open. Best effort: the page may be gone
  // before the frames leave.
  const onPageHide = () => {
    sendPilotRelease();
    sendPilotBye();
  };
  // Closing the tab with no RC while armed ends in the link-loss action:
  // the browser's own leave prompt asks first.
  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    const text = pilotLeaveWarning();
    if (text === null) return;
    e.preventDefault();
    e.returnValue = text;
  };
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("beforeunload", onBeforeUnload);

  usePilotLinkStore.getState().set({ agentFor: droneId, controlMode: null });
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
      sender = live && socket ? coalescingSender(socket) : null;
      // A dropped stream forgets the control mode: until the pilot reports
      // it again, neither the pilot nor the FC route is taken.
      usePilotLinkStore.getState().set({
        droneId: live ? droneId : null,
        connected: live,
        ...(live ? {} : { streaming: false, controlMode: null }),
      });
      if (!live) failPendingActions(PILOT_CLOSED);
    },
  });

  return {
    close: () => {
      sendPilotRelease();
      sendPilotBye();
      sender = null;
      usePilotLinkStore.getState().set({
        droneId: null,
        connected: false,
        streaming: false,
        controlMode: null,
        agentFor: null,
      });
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
      hb.stop();
      if (heartbeat === hb) heartbeat = null;
      leaveState = null;
      failPendingActions(PILOT_CLOSED);
      teardown();
      socket = null;
    },
  };
}
