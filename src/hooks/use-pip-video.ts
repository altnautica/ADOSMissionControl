/**
 * @module hooks/use-pip-video
 * @description An ISOLATED WHEP player for the cockpit picture-in-picture
 * inset. The main cockpit feed is the *shared* receive session in
 * `video/webrtc/session-state`, which holds exactly one connection at a time;
 * the PiP is a genuinely different stream, so it needs its own. This hook
 * owns a private `RTCPeerConnection` per PiP `whepUrl`, mirrors the main WHEP
 * SDP exchange (recv-only transceivers + low-latency receiver hints, offer →
 * ICE gather → POST → answer → ontrack), and attaches the resulting stream to
 * the passed `<video>` element. It writes no shared state and polls no stats.
 *
 * ## Why not just call `startStream()`
 *
 * This used to say a second `startStream()` would tear down the main feed,
 * and it was right: `startStream` opened by closing whatever connection was
 * installed, so a second caller — for any URL, same stream or not — killed
 * the first surface's video. That hazard is gone. `startStream` now acquires
 * through the session registry, which shares a live connection with every
 * caller asking for the same stream identity and refuses to evict an
 * incumbent until a replacement has actually produced a track.
 *
 * The reason this hook still exists is the part the registry did not change:
 * there is one shared receive session, by design, so acquiring a *second,
 * different* stream through it displaces the first. A PiP leg is a different
 * stream by definition. Rendering EO and thermal at once means two
 * connections, and this hook owns the second one — as
 * `useAgentVideoSession` and `CameraThumbnail` own theirs.
 *
 * Only the `concurrent` switch mechanism (N addressable WHEP paths) supports
 * PiP; a single-encoder `switchable` node has just one live stream. Exercised
 * on a real multi-stream node (a smart pod); in demo mode the inset uses the
 * synthetic canvas feed instead of this hook.
 *
 * @license GPL-3.0-only
 */

"use client";

import { useCallback, useEffect, useState } from "react";

import {
  LAN_ICE_GATHER_TIMEOUT_MS,
  LAN_ONTRACK_TIMEOUT_MS,
} from "@/lib/video/webrtc-constants";
import {
  applyJitterTarget,
  jitterTargetForRung,
} from "@/lib/video/webrtc/jitter-controller";

/** Connection state of the isolated PiP player, so the inset can show a
 * spinner / NO SIGNAL + retry instead of a silent black rectangle. */
export type PipVideoStatus = "idle" | "connecting" | "live" | "error";

export interface PipVideoState {
  status: PipVideoStatus;
  /** Re-attempt the connection (used by the inset's retry affordance). */
  retry: () => void;
}

/**
 * Drive a `<video>` element from a WHEP endpoint with a private peer connection.
 * A null `whepUrl` (or unmount) tears the connection down. Independent of the
 * main cockpit video session. Returns the connection status + a retry so the
 * inset can surface a failure rather than swallowing it.
 */
export function usePipVideo(
  whepUrl: string | null,
  videoRef: React.RefObject<HTMLVideoElement | null>,
): PipVideoState {
  const [status, setStatus] = useState<PipVideoStatus>("idle");
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (!whepUrl) {
      setStatus("idle");
      return;
    }
    setStatus("connecting");
    // The inset's <video> is stable for the effect's life; capture it once so
    // the async attach and the cleanup act on the same element.
    const videoEl = videoRef.current;
    const controller = new AbortController();
    const { signal } = controller;
    let pc: RTCPeerConnection | null = null;
    let cancelled = false;

    const start = async () => {
      try {
        const newPc = new RTCPeerConnection({ iceServers: [] });
        pc = newPc;
        newPc.addTransceiver("video", { direction: "recvonly" });
        // Ladder rung 0 — add no buffer. This is the same helper the main
        // flows use, replacing a second copy of the hardcoded 50 ms nobody
        // measured. The inset runs no stats poll, so unlike the main
        // session it stays at rung 0 rather than closing a loop: an inset
        // has no latency budget of its own to spend, and inventing a second
        // control loop for a corner window is not worth the code.
        applyJitterTarget(newPc, jitterTargetForRung(0));
        newPc.addTransceiver("audio", { direction: "recvonly" });

        const stream = new Promise<MediaStream>((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error("pip: no video track")),
            LAN_ONTRACK_TIMEOUT_MS,
          );
          newPc.ontrack = (event) => {
            if (event.streams[0]) {
              clearTimeout(timeout);
              resolve(event.streams[0]);
            }
          };
        });

        const offer = await newPc.createOffer();
        if (signal.aborted) return;
        await newPc.setLocalDescription(offer);
        await new Promise<void>((resolve) => {
          if (newPc.iceGatheringState === "complete") return resolve();
          const check = () => {
            if (newPc.iceGatheringState === "complete") {
              newPc.removeEventListener("icegatheringstatechange", check);
              resolve();
            }
          };
          newPc.addEventListener("icegatheringstatechange", check);
          setTimeout(resolve, LAN_ICE_GATHER_TIMEOUT_MS);
        });
        if (signal.aborted) return;

        const response = await fetch(whepUrl, {
          method: "POST",
          headers: { "Content-Type": "application/sdp" },
          body: newPc.localDescription!.sdp,
          signal,
        });
        if (!response.ok) throw new Error(`pip WHEP ${response.status}`);
        const answerSdp = await response.text();
        if (signal.aborted) return;
        await newPc.setRemoteDescription({ type: "answer", sdp: answerSdp });
        const media = await stream;
        if (cancelled || signal.aborted) return;
        if (videoEl) videoEl.srcObject = media;
        setStatus("live");
      } catch {
        // A failed PiP inset is non-fatal — the main feed is unaffected — but
        // it is surfaced (spinner → NO SIGNAL + retry) rather than swallowed.
        // A teardown-triggered abort is not a real failure, so it is ignored.
        if (!cancelled && !signal.aborted) setStatus("error");
      }
    };
    void start();

    return () => {
      cancelled = true;
      controller.abort();
      if (videoEl) videoEl.srcObject = null;
      if (pc) {
        try {
          pc.getReceivers().forEach((r) => r.track?.stop());
          pc.close();
        } catch {
          // already closed
        }
      }
    };
  }, [whepUrl, videoRef, attempt]);

  return { status, retry };
}
