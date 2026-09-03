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
} from "../webrtc-constants";
import {
  abortable,
  checkAborted,
  classifyError,
} from "../webrtc-helpers";
import { applyJitterTarget, jitterTargetForRung } from "./jitter-controller";
import {
  closePeerConnection,
  reportHealth,
  tryIceRestart,
} from "./peer-utils";
import { attachSeiTransform } from "./sei-transform";
import {
  acquireSession,
  getPc,
  installSession,
  setPc,
  whepSessionKey,
} from "./session-state";
import { startStatsPolling, stopStatsPolling } from "./stats-tracker";

/**
 * Acquire the LAN-direct WHEP stream at `whepUrl`.
 *
 * Deduped by stream identity: a surface asking for a feed that is already
 * live gets the same `MediaStream` and a lease on the existing connection,
 * and one asking for a feed whose handshake is in flight joins that
 * handshake. Only a genuinely different stream negotiates.
 *
 * @param whepUrl — Full WHEP URL, e.g. `http://192.168.1.50:8889/stream/whep`
 * @param signal  — Optional AbortSignal. When fired, this caller stops
 *                  waiting and throws AbortError. The underlying handshake
 *                  is only cancelled once no caller is waiting on it, so the
 *                  cascade cancelling a mode can no longer cancel a
 *                  handshake another surface still needs.
 * @returns The MediaStream to attach to a <video> element.
 */
export function startStream(
  whepUrl: string,
  signal?: AbortSignal,
): Promise<MediaStream> {
  return acquireSession(whepSessionKey(whepUrl), signal, (negotiationSignal) =>
    negotiateWhep(whepUrl, negotiationSignal),
  );
}

/** The SDP exchange itself. Runs at most once per stream identity. */
async function negotiateWhep(
  whepUrl: string,
  signal: AbortSignal,
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
      if (state === "disconnected") {
        console.warn("[webrtc-client] LAN WHEP disconnected — attempting ICE restart");
        tryIceRestart(newPc);
      } else if (state === "failed" || state === "closed") {
        console.warn("[webrtc-client] LAN WHEP terminal state:", state);
        const s = useVideoStore.getState();
        s.setStreaming(false);
        s.updateStats(0, 0);
        stopStatsPolling();
        reportHealth(transport, {
          state: "failed",
          stage: "connected",
          code: "ice-disconnect",
          error: `Connection ${state}`,
        });
      }
    };

    // Receive-only transceivers. The receiver-side latency knobs are set
    // before negotiation so the first frames are not buffered against a
    // default nobody chose.
    //
    // The starting depth is ladder rung 0 — add nothing — rather than the
    // 50 ms this used to hardcode and call "the FPV-grade default". No
    // measurement produced 50, and it is wrong in both directions: pure
    // latency tax on a clean LAN, and far too shallow to conceal a loss
    // burst on a radio link. From here the depth is a closed loop over what
    // the receiver actually measures (`jitter-controller`, driven from the
    // 1 Hz stats poll), so it lands where the link puts it instead of where
    // a constant guessed.
    //
    // Distinct from the previously-removed mungeForLowLatency() SDP hack.
    // That pinned Chrome's MINIMUM jitter buffer via the conference flag
    // and caused decoder stalls on WiFi reordering. These are
    // *receiver-side runtime properties* — a target, not a floor — so the
    // failure mode of the prior approach does not apply.
    localPc.addTransceiver("video", { direction: "recvonly" });
    // Reports 0 on a browser that implements neither property (WebKit
    // implements neither and cannot be tuned from JS at all), which is the
    // honest answer rather than a silent assumption that it took effect.
    applyJitterTarget(localPc, jitterTargetForRung(0));
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

    // Send offer to WHEP endpoint (fetch supports AbortSignal natively)
    const response = await fetch(whepUrl, {
      method: "POST",
      headers: { "Content-Type": "application/sdp" },
      body: offerSdp,
      signal,
    });

    if (!response.ok) {
      const msg = response.status === 404
        ? "No video stream on agent (mediamtx 404, video pipeline not running)"
        : `WHEP request failed: ${response.status} ${response.statusText}`;
      throw new Error(msg);
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
    const stream = await abortable(trackPromise, signal);
    checkAborted(signal);

    // Publish as the shared session before any store write, so a concurrent
    // acquisition of the same stream is served from here rather than
    // starting a second handshake. This is also where a session for a
    // different stream is displaced and closed.
    installSession(whepSessionKey(whepUrl), localPc, stream);

    store.setStreamUrl(whepUrl);
    store.setStreaming(true);
    // Classify and publish the active transport so the UI can show
    // "LAN DIRECT" / "CLOUD WHEP" badges.
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
    if (localPc) {
      closePeerConnection(localPc);
      if (localPc === getPc()) setPc(null);
    }
    const { code, message } = classifyError(err);
    reportHealth(transport, { state: "failed", code, error: message });
    throw err;
  }
}
