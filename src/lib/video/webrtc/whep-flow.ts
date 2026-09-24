/**
 * @module video/webrtc/whep-flow
 * @description LAN-direct WHEP path. The cascade hook calls `startStream`
 * when attempting the `lan-whep` mode; this module handles the SDP
 * exchange against mediamtx, ICE gathering, ontrack wait, and the
 * receiver-side latency hints.
 *
 * Acquisition is deduped by stream identity through the session registry, so
 * the four surfaces that render the same feed share one negotiation and one
 * connection instead of closing each other's. See
 * `./session-state` for why that is ownership rather than politeness.
 *
 * @license GPL-3.0-only
 */

import { useVideoStore, type VideoTransport } from "@/stores/video-store";
import {
  LAN_ICE_GATHER_TIMEOUT_MS,
  LAN_ONTRACK_TIMEOUT_MS,
  type TimerHandle,
} from "../webrtc-constants";
import {
  abortable,
  checkAborted,
  classifyError,
} from "../webrtc-helpers";
import { closePeerConnection, reportHealth } from "./peer-utils";
import { onPeerConnectionClose } from "./teardown";
import { attachSeiTransform } from "./sei-transform";
import {
  acquireSession,
  getPc,
  installSession,
  setPc,
  whepSessionKey,
} from "./session-state";
import {
  applyNegotiatedJitterTarget,
  startStatsPolling,
  stopStatsPolling,
} from "./stats-tracker";

/**
 * How long a `disconnected` peer connection is given to come back on its own
 * before the session is re-cascaded.
 *
 * ICE can recover from a WiFi/radio glitch without a new offer, so tearing
 * down on the first `disconnected` event would throw away a session that was
 * about to resume. Three seconds is long enough for that recovery and short
 * enough that a link which is genuinely gone is re-dialled while the operator
 * is still looking at the same manoeuvre.
 */
const ICE_DISCONNECT_GRACE_MS = 3000;

/**
 * Acquire the LAN-direct WHEP stream at `whepUrl`.
 *
 * Deduped by stream identity: a surface asking for a feed that is already
 * live gets the same `MediaStream` and a lease on the existing connection,
 * and one asking for a feed whose handshake is in flight joins that
 * handshake. Only a genuinely different stream negotiates.
 *
 * @param whepUrl — Full WHEP URL on the agent's front, e.g.
 *                  `http://192.168.1.50:8080/whep` or `/whep?camera=<leg>`
 *                  resolved against it.
 * @param signal  — Optional AbortSignal. When fired, this caller stops
 *                  waiting and throws AbortError. The underlying handshake
 *                  is only cancelled once no caller is waiting on it, so the
 *                  cascade cancelling a mode can no longer cancel a
 *                  handshake another surface still needs.
 * @param apiKey  — The paired node's API key, sent as `X-ADOS-Key` on the
 *                  offer and on the session DELETE. The front refuses an
 *                  unauthenticated WHEP request on a paired node. Pass null
 *                  only for an endpoint that is not an agent (a SITL URL).
 * @returns The MediaStream to attach to a <video> element.
 */
export function startStream(
  whepUrl: string,
  signal: AbortSignal | undefined,
  apiKey: string | null,
): Promise<MediaStream> {
  return acquireSession(whepSessionKey(whepUrl), signal, (negotiationSignal) =>
    negotiateWhep(whepUrl, negotiationSignal, apiKey),
  );
}

/** The SDP exchange itself. Runs at most once per stream identity. */
async function negotiateWhep(
  whepUrl: string,
  signal: AbortSignal,
  apiKey: string | null,
): Promise<MediaStream> {
  const store = useVideoStore.getState();
  const startedAt = Date.now();
  // This is the LAN-direct WHEP path; the cascade hook only calls it when
  // attempting lan-whep. The URL itself may be a Cloudflare tunnel on
  // cloud-routed deployments, but the *mode* the cascade attached to is
  // still lan-whep. Trust the cascade, not detectTransportFromUrl which
  // mis-classifies tunneled URLs.
  const transport: VideoTransport = "lan-whep";

  // Report testing state for the cascade UX
  reportHealth(transport, { state: "testing", stage: "starting" });

  // No pre-emptive teardown of whatever is currently installed. The registry
  // displaces the incumbent in `installSession`, i.e. only once this
  // handshake has actually produced a track — closing it here is what used
  // to blank a working surface the moment a second one mounted, and blanked
  // it permanently when the new attempt then failed.

  // Hold a local reference so handlers can verify they're still the
  // active pc. `getPc()` may move to a newer connection (e.g. the cascade
  // switching modes) and we don't want stale handlers to operate on the
  // wrong one.
  let localPc: RTCPeerConnection | null = null;
  // Armed while this connection sits in `disconnected`, cleared the moment it
  // comes back. Module-free so a second negotiation cannot inherit it.
  let disconnectGrace: TimerHandle | null = null;
  const clearDisconnectGrace = () => {
    if (disconnectGrace === null) return;
    clearTimeout(disconnectGrace);
    disconnectGrace = null;
  };
  try {
    checkAborted(signal);

    const newPc = new RTCPeerConnection({
      iceServers: [], // Local network — no STUN/TURN needed
    });
    localPc = newPc;
    setPc(newPc);

    // Capture newPc (a const) in the handler closure. Even if a
    // parallel call replaces the global pc, this handler still refers
    // to ITS OWN connection, and bails on the (newPc !== getPc())
    // check.
    newPc.onconnectionstatechange = () => {
      if (newPc !== getPc()) return; // a newer pc has taken over
      const state = newPc.connectionState;
      const s = useVideoStore.getState();
      if (state === "disconnected") {
        // `disconnected` used to fire a bare `restartIce()` and nothing
        // else: no store write, no health report, no recovery that could
        // ever reach mediamtx (WHEP has no in-place renegotiation and this
        // flow keeps no resource URL to PATCH). The operator was left with
        // a frozen frame, a green transport badge, and no reconnection —
        // the exact "process is alive so the work must be happening"
        // failure the delta-counter rule exists to prevent.
        //
        // It is now an OBSERVABLE, RECOVERABLE state: the surfaces learn
        // about it immediately, and if connectivity has not returned inside
        // the grace window the stall edge re-cascades the session (the same
        // edge the frozen-stream watchdog raises). No attempt cap, no
        // terminal state — the retry loop above this runs until the link
        // comes back.
        console.warn(
          "[webrtc-client] LAN WHEP disconnected — degraded, re-cascading if it does not recover",
        );
        s.setVideoDegraded("ice-disconnect");
        reportHealth(transport, {
          state: "failed",
          stage: "connected",
          code: "ice-disconnect",
          error: "ICE disconnected",
        });
        if (disconnectGrace === null) {
          disconnectGrace = setTimeout(() => {
            disconnectGrace = null;
            if (newPc !== getPc()) return;
            if (newPc.connectionState === "connected") return;
            useVideoStore.getState().signalVideoStall();
          }, ICE_DISCONNECT_GRACE_MS);
        }
        return;
      }
      if (state === "connected") {
        // Recovered on its own inside the grace window.
        clearDisconnectGrace();
        s.setVideoDegraded(null);
        reportHealth(transport, { state: "ok", stage: "connected" });
        return;
      }
      if (state === "failed" || state === "closed") {
        console.warn("[webrtc-client] LAN WHEP terminal state:", state);
        clearDisconnectGrace();
        s.setVideoDegraded(null);
        s.setStreaming(false);
        s.updateStats(null, null);
        stopStatsPolling();
        reportHealth(transport, {
          state: "failed",
          stage: "connected",
          code: "ice-disconnect",
          error: `Connection ${state}`,
        });
      }
    };

    // Receive-only transceivers.
    //
    // The receiver's jitter-buffer depth is NOT set here. It used to be —
    // `applyJitterTarget(pc, jitterTargetForRung(0))` right after
    // `addTransceiver` — and that write does not survive the transceiver
    // being associated with the negotiated media description, so every
    // session ran on the browser's own adaptive target (commonly 200 ms and
    // more on Chromium) while this line claimed otherwise. The deliberate
    // baseline is applied after `setRemoteDescription` below, which is the
    // first point at which it sticks.
    //
    // Distinct from the previously-removed mungeForLowLatency() SDP hack.
    // That pinned Chrome's MINIMUM jitter buffer via the conference flag
    // and caused decoder stalls on WiFi reordering. The receiver property is
    // a target, not a floor, so the failure mode of the prior approach does
    // not apply.
    localPc.addTransceiver("video", { direction: "recvonly" });
    localPc.addTransceiver("audio", { direction: "recvonly" });

    const offer = await abortable(localPc.createOffer(), signal);
    checkAborted(signal);
    await abortable(localPc.setLocalDescription(offer), signal);
    checkAborted(signal);

    // Wait for ICE gathering to complete (or LAN_ICE_GATHER_TIMEOUT_MS)
    await new Promise<void>((resolve) => {
      if (localPc!.iceGatheringState === "complete") {
        resolve();
        return;
      }
      const check = () => {
        if (localPc?.iceGatheringState === "complete") {
          localPc.removeEventListener("icegatheringstatechange", check);
          resolve();
        }
      };
      localPc!.addEventListener("icegatheringstatechange", check);
      setTimeout(resolve, LAN_ICE_GATHER_TIMEOUT_MS);
    });
    checkAborted(signal);

    // SDP offer — send as-is. The previous mungeForLowLatency() injected
    // a=x-google-flag:conference which pins Chrome to a minimum jitter
    // buffer. That flag is designed for multi-party conferences on
    // reliable networks, not one-way WHEP streaming over WiFi. On WiFi
    // with any jitter or reordering, the minimum buffer causes decoder
    // stalls that appear as video freezes after a few seconds. mediamtx's
    // own test page (no SDP munge) streams indefinitely.
    const offerSdp = localPc.localDescription!.sdp;

    // Send offer to WHEP endpoint (fetch supports AbortSignal natively). The
    // agent's front authenticates /whep like any other data-plane route.
    const authHeaders: Record<string, string> = apiKey ? { "X-ADOS-Key": apiKey } : {};
    const response = await fetch(whepUrl, {
      method: "POST",
      headers: { "Content-Type": "application/sdp", ...authHeaders },
      body: offerSdp,
      signal,
    });

    if (!response.ok) {
      const msg = response.status === 404
        ? "No video stream on agent (WHEP 404, video pipeline not running)"
        : response.status === 401 || response.status === 403
          ? `WHEP request refused: ${response.status} (node API key missing or rejected)`
          : `WHEP request failed: ${response.status} ${response.statusText}`;
      throw new Error(msg);
    }

    // The server keeps a session resource at `Location` until it is deleted.
    // Release it whenever this connection is torn down, on success or on a
    // later failure, so closed viewers do not pile up on the agent.
    const location = response.headers.get("Location");
    if (location) {
      const resourceUrl = new URL(location, whepUrl).toString();
      onPeerConnectionClose(localPc, () => {
        void fetch(resourceUrl, { method: "DELETE", headers: authHeaders, keepalive: true }).catch(
          () => {},
        );
      });
    }

    const answerSdp = await abortable(response.text(), signal);
    checkAborted(signal);

    // Set ontrack BEFORE setRemoteDescription to avoid race condition
    // (track events can fire during or immediately after setRemoteDescription)
    const trackPromise = new Promise<MediaStream>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`No video track received within ${LAN_ONTRACK_TIMEOUT_MS / 1000}s`)),
        LAN_ONTRACK_TIMEOUT_MS,
      );
      localPc!.ontrack = (event) => {
        if (event.streams[0]) {
          clearTimeout(timeout);
          resolve(event.streams[0]);
        }
      };
    });

    await abortable(localPc.setRemoteDescription({ type: "answer", sdp: answerSdp }), signal);

    // The deliberate receiver buffer depth, applied HERE and nowhere else on
    // this path. `setRemoteDescription` is the first moment the video
    // transceiver's receiver is associated with the negotiated media
    // description; a target written before that is discarded by the
    // association, which is why this used to sit above `createOffer` and do
    // nothing. It is also before the first frame arrives (ontrack is still
    // pending below), so no frame is ever presented against a depth nobody
    // chose. Reports 0 tuned receivers on a browser that implements neither
    // knob — WebKit implements neither and cannot be tuned from JS at all —
    // which is the honest answer rather than a silent assumption.
    applyNegotiatedJitterTarget(localPc);

    const stream = await abortable(trackPromise, signal);
    checkAborted(signal);

    // Publish as the shared session before any store write, so a concurrent
    // acquisition of the same stream is served from here rather than
    // starting a second handshake. This is also where a session for a
    // different stream is displaced and closed.
    installSession(whepSessionKey(whepUrl), localPc, stream);

    store.setStreamUrl(whepUrl);
    store.setStreaming(true);
    store.setVideoDegraded(null);
    // Publish the active transport so the UI can show its badge.
    store.setTransport(transport);
    // Report success with connection establishment time (NOT live RTT,
    // which is tracked separately).
    reportHealth(transport, {
      state: "ok",
      stage: "connected",
      connectMs: Date.now() - startedAt,
    });

    // Start stats polling
    startStatsPolling();
    // Attach SEI script transform on the receiver to enable true
    // camera→monitor latency. Pass-through only — never modifies
    // frames; no-ops on browsers without RTCRtpScriptTransform.
    attachSeiTransform(localPc);

    return stream;
  } catch (err) {
    // Tear down the local pc on any failure. Only clear the global if we're
    // still the active pc (a parallel call may have already replaced us).
    clearDisconnectGrace();
    if (localPc) {
      closePeerConnection(localPc);
      if (localPc === getPc()) setPc(null);
    }
    const { code, message } = classifyError(err);
    reportHealth(transport, { state: "failed", code, error: message });
    throw err;
  }
}
