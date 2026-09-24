/**
 * @module video/webrtc/teardown
 * @description PeerConnection teardown shared by every receive flow. A leaf
 * module: the flows and the client barrel import it, and it imports none of
 * them.
 * @license GPL-3.0-only
 */

/** One-shot hooks run when a connection is torn down through closePeerConnection. */
const closeHooks = new WeakMap<RTCPeerConnection, () => void>();

/**
 * Run `hook` once when `pc` is torn down by {@link closePeerConnection}.
 * `pc.close()` fires no event, so a per-connection resource on the server
 * (the WHEP session at `Location`) is released from here.
 */
export function onPeerConnectionClose(pc: RTCPeerConnection, hook: () => void): void {
  closeHooks.set(pc, hook);
}

/**
 * Tear down a PeerConnection cleanly across browsers.
 *
 * Safari leaves MediaStreamTracks in the "live" state after pc.close(),
 * which holds the camera/mic permission and forces the next stream
 * start to re-prompt the user. Stopping every receiver and sender track
 * before closing the connection releases those resources deterministically.
 *
 * Also nulls the event handlers BEFORE close() to suppress spurious
 * onconnectionstatechange("closed") callbacks during teardown that
 * re-enter store updates (w3c/webrtc-pc#1218).
 *
 * Idempotent and exception-safe — every step is individually try/caught.
 *
 * Active call sites (every PeerConnection teardown in the per-flow modules
 * routes through this helper):
 *   - whep-flow.ts: pre-start cleanup            -> closePeerConnection(existing)
 *   - whep-flow.ts: error-path teardown          -> closePeerConnection(localPc)
 *   - mqtt-flow.ts: pre-start cleanup            -> closePeerConnection(existing)
 *   - mqtt-flow.ts: error-path teardown          -> closePeerConnection(localPc)
 *   - lifecycle.ts: stopStream() teardown        -> closePeerConnection(current)
 */
export function closePeerConnection(target: RTCPeerConnection | null): void {
  if (!target) return;
  try {
    target.ontrack = null;
    target.onconnectionstatechange = null;
    target.onicecandidateerror = null;
    target.oniceconnectionstatechange = null;
    target.onicegatheringstatechange = null;
    target.onsignalingstatechange = null;
  } catch { /* noop */ }
  try {
    target.getReceivers().forEach((r) => {
      try { r.track?.stop(); } catch { /* noop */ }
    });
  } catch { /* noop */ }
  try {
    target.getSenders().forEach((s) => {
      try { s.track?.stop(); } catch { /* noop */ }
    });
  } catch { /* noop */ }
  try {
    target.close();
  } catch { /* noop */ }
  const hook = closeHooks.get(target);
  if (hook) {
    closeHooks.delete(target);
    try { hook(); } catch { /* noop */ }
  }
}
