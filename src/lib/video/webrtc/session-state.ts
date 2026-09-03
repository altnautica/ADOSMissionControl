/**
 * @module video/webrtc/session-state
 * @description The one owner of the shared receive session: the peer
 * connection, the media stream it produced, the `<video>` element bound to
 * it, and the MediaRecorder writing off it.
 *
 * ## Why this is a registry and not a set of singletons
 *
 * It used to be four module-level `let`s with bare get/set accessors, and
 * `startStream` opened with "clean up any stale connection before starting
 * fresh" — an unconditional `closePeerConnection(existing)`. Four surfaces
 * reach that code for the *same* stream (the cockpit `VideoCanvas`, the
 * focused-drone `VideoFeedCard`, the HDMI-kiosk `VideoBackground`, and the
 * context-rail `MiniVideoView`), each through its own effect. So mounting the
 * second one closed the first one's connection, the first surface went black,
 * and either surface's unmount then tore down the survivor. One stream, N
 * negotiations, N-1 casualties.
 *
 * The fix is ownership rather than politeness: a session is identified by the
 * stream it carries ({@link whepSessionKey} / {@link mqttSessionKey}) and is
 * held by a *lease count*. Acquiring a stream that is already live returns the
 * same `MediaStream` and takes a lease. Acquiring one whose negotiation is
 * still in flight joins that negotiation. Only the last release tears the
 * connection down. A negotiation for a genuinely different stream displaces
 * the incumbent — there is one shared receive session by design, and a surface
 * that needs a second concurrent leg uses a private connection (`usePipVideo`,
 * `useAgentVideoSession`, `CameraThumbnail`) rather than this one.
 *
 * `getPc()` stays the accessor the stats poller, the ICE-restart guard, and
 * the per-flow error paths read, so "is this handler still the active
 * connection" keeps its existing meaning.
 *
 * @license GPL-3.0-only
 */

import { abortable } from "../webrtc-helpers";

/** Stream identity for a LAN-direct WHEP endpoint. */
export function whepSessionKey(whepUrl: string): string {
  return `whep:${whepUrl}`;
}

/** Stream identity for an MQTT-signalled P2P session. */
export function mqttSessionKey(deviceId: string): string {
  return `mqtt:${deviceId}`;
}

/** The live shared receive session. */
interface VideoSession {
  key: string;
  pc: RTCPeerConnection;
  stream: MediaStream;
  /** Outstanding holders. Teardown happens when this reaches zero. */
  leases: number;
}

/**
 * A negotiation in flight. Its `controller` is the signal the negotiation
 * itself runs under, aborted only when every waiter has abandoned it — so one
 * surface unmounting mid-handshake no longer cancels the handshake another
 * surface is still waiting on.
 */
interface PendingNegotiation {
  key: string;
  promise: Promise<MediaStream>;
  controller: AbortController;
  waiters: number;
}

/** The installed, leasable session. */
let session: VideoSession | null = null;
/**
 * The connection currently handshaking, if any.
 *
 * Kept apart from `session` on purpose. A new negotiation must be visible to
 * the per-flow `onconnectionstatechange` guards and to the ICE-restart
 * cooldown *while it is still in progress*, but it must not evict a session
 * that other surfaces are watching until it has actually produced a track —
 * otherwise a LAN attempt that fails leaves the operator with nothing where
 * they previously had a working feed, and the evicted connection is never
 * closed at all.
 */
let negotiatingPc: RTCPeerConnection | null = null;
let pending: PendingNegotiation | null = null;

let videoElement: HTMLVideoElement | null = null;
let mediaRecorder: MediaRecorder | null = null;
let recordedChunks: Blob[] = [];

/** Teardown hook, injected so this module needs no peer-connection imports. */
type Teardown = (pc: RTCPeerConnection | null) => void;
let teardown: Teardown = () => {};

/**
 * Install the peer-connection teardown run when the last lease is released
 * (or when a session is displaced). Registered by `peer-utils`, which is the
 * lowest module every per-flow path already imports, so the teardown is
 * armed by the time any flow can install a session — registering it from
 * `lifecycle` would leave it a no-op for a caller that never imported
 * `stopStream`, and a displaced connection would then leak.
 */
export function setSessionTeardown(fn: Teardown): void {
  teardown = fn;
}

/** Counters for the dedupe behaviour, so a regression is observable. */
export interface SessionCounters {
  /** WHEP/SDP negotiations actually performed. */
  negotiations: number;
  /** Acquisitions served from an already-live session. */
  sharedLive: number;
  /** Acquisitions that joined a negotiation already in flight. */
  sharedPending: number;
  /** Sessions torn down because a different stream took the slot. */
  displaced: number;
}

const counters: SessionCounters = {
  negotiations: 0,
  sharedLive: 0,
  sharedPending: 0,
  displaced: 0,
};

export interface SessionSnapshot extends SessionCounters {
  key: string | null;
  leases: number;
  pendingKey: string | null;
  pendingWaiters: number;
  /** True while a handshake is in progress. */
  negotiating: boolean;
}

/** Current ownership state. Diagnostics and tests only. */
export function sessionSnapshot(): SessionSnapshot {
  return {
    key: session?.key ?? null,
    leases: session?.leases ?? 0,
    pendingKey: pending?.key ?? null,
    pendingWaiters: pending?.waiters ?? 0,
    negotiating: negotiatingPc !== null,
    ...counters,
  };
}

/** Reset every owned reference. Tests only — never a production path. */
export function resetSessionStateForTest(): void {
  session = null;
  negotiatingPc = null;
  pending = null;
  videoElement = null;
  mediaRecorder = null;
  recordedChunks = [];
  counters.negotiations = 0;
  counters.sharedLive = 0;
  counters.sharedPending = 0;
  counters.displaced = 0;
}

/**
 * True when the session is still usable as a shared receive path: the
 * connection is up (or coming up) and the video track has not ended.
 *
 * `connectionState` alone is not enough — a connection can sit at
 * "connected" with a dead track after a remote hangup, and handing that to a
 * second surface as a live stream is how one gets a permanently black pane
 * with no error.
 */
function isReusable(candidate: VideoSession): boolean {
  const state = candidate.pc.connectionState;
  if (state !== "new" && state !== "connecting" && state !== "connected") {
    return false;
  }
  const tracks = candidate.stream.getVideoTracks();
  if (tracks.length === 0) return false;
  return tracks.some((t) => t.readyState === "live");
}

/**
 * Negotiate `key` exactly once, however many callers ask for it.
 *
 * @param key      Stream identity from {@link whepSessionKey} / {@link mqttSessionKey}.
 * @param signal   The *caller's* cancellation. It abandons this caller's wait;
 *                 the negotiation is only aborted once no caller is left.
 * @param negotiate Performs the SDP exchange under the signal it is handed and
 *                 resolves with the received stream. It must call
 *                 {@link installSession} before resolving.
 */
export async function acquireSession(
  key: string,
  signal: AbortSignal | undefined,
  negotiate: (negotiationSignal: AbortSignal) => Promise<MediaStream>,
): Promise<MediaStream> {
  if (session && session.key === key && isReusable(session)) {
    session.leases += 1;
    counters.sharedLive += 1;
    return session.stream;
  }
  if (pending && pending.key === key) {
    counters.sharedPending += 1;
    return joinPending(pending, signal);
  }

  const controller = new AbortController();
  counters.negotiations += 1;
  // Register before the first `await` so a same-tick second caller sees the
  // in-flight negotiation instead of starting a second one.
  const started: PendingNegotiation = {
    key,
    promise: negotiate(controller.signal),
    controller,
    waiters: 0,
  };
  pending = started;
  try {
    return await joinPending(started, signal);
  } finally {
    if (pending === started) pending = null;
  }
}

/**
 * Wait on an in-flight negotiation, accounting this caller as a waiter.
 *
 * The negotiation is aborted only when the waiter count returns to zero with
 * nothing installed, which is what stops a mid-handshake unmount from
 * cancelling a handshake somebody else still needs.
 */
async function joinPending(
  target: PendingNegotiation,
  signal: AbortSignal | undefined,
): Promise<MediaStream> {
  target.waiters += 1;
  try {
    // The caller's signal only abandons this wait; `target.promise` keeps
    // running for the remaining waiters.
    return await abortable(target.promise, signal);
  } finally {
    target.waiters -= 1;
    if (target.waiters === 0 && !(session && session.key === target.key)) {
      target.controller.abort();
    }
  }
}

/**
 * Publish a completed negotiation as the shared session, with one lease held
 * by the caller that started it.
 *
 * A session for a *different* stream is torn down here, and not a moment
 * earlier: this slot holds one shared receive path, but evicting the
 * incumbent before its replacement exists is how a failed attempt leaves an
 * operator with a black pane where a working feed was. Displacing a session
 * that was still usable is counted and logged with the lease count it took
 * down, because silently blanking another surface is exactly the failure this
 * module exists to stop; replacing a dead one is routine and says nothing.
 */
export function installSession(
  key: string,
  pc: RTCPeerConnection,
  stream: MediaStream,
): void {
  const incumbent = session;
  session = { key, pc, stream, leases: 1 };
  if (negotiatingPc === pc) negotiatingPc = null;
  if (incumbent && incumbent.pc !== pc) {
    if (incumbent.leases > 0 && isReusable(incumbent)) {
      counters.displaced += 1;
      console.warn(
        `[video-session] ${incumbent.key} displaced by ${key} with ${incumbent.leases} lease(s) still held`,
      );
    }
    teardown(incumbent.pc);
  }
}

/**
 * Release one lease. Returns true when this release tore the session down.
 *
 * A release with no lease outstanding is a no-op, not a teardown: several
 * effects call `stopStream()` on cleanup paths that never acquired, and
 * honouring those would let one surface's unmount kill another's live feed —
 * the bug in a second costume.
 */
export function releaseSession(): boolean {
  if (!session || session.leases === 0) return false;
  session.leases -= 1;
  if (session.leases > 0) return false;
  const { pc } = session;
  session = null;
  teardown(pc);
  return true;
}

/** Drop the session unconditionally, whatever the lease count. */
export function discardSession(): void {
  const current = session;
  session = null;
  if (current) teardown(current.pc);
}

/**
 * The connection this module currently cares about: the one handshaking if a
 * handshake is in flight, otherwise the installed session's.
 *
 * This is what the per-flow `newPc !== getPc()` guards mean by "a newer pc
 * has taken over", and what the stats poller reads.
 */
export function getPc(): RTCPeerConnection | null {
  return negotiatingPc ?? session?.pc ?? null;
}

/**
 * Mark `next` as the connection currently handshaking, or clear that mark
 * with `null`.
 *
 * Deliberately does NOT touch the installed session: a handshake in progress
 * has produced no track, so it has nothing to hand a lease holder, and
 * clearing the mark after a failure must restore `getPc()` to the session
 * that was working all along. {@link installSession} is what promotes a
 * connection to leasable.
 */
export function setPc(next: RTCPeerConnection | null): void {
  negotiatingPc = next;
}

export function getVideoElement(): HTMLVideoElement | null {
  return videoElement;
}

export function setVideoElementRef(el: HTMLVideoElement | null): void {
  videoElement = el;
}

export function getMediaRecorder(): MediaRecorder | null {
  return mediaRecorder;
}

export function setMediaRecorder(next: MediaRecorder | null): void {
  mediaRecorder = next;
}

export function getRecordedChunks(): Blob[] {
  return recordedChunks;
}

export function pushRecordedChunk(chunk: Blob): void {
  recordedChunks.push(chunk);
}

export function clearRecordedChunks(): void {
  recordedChunks = [];
}
