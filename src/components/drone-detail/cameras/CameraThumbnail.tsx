"use client";

/**
 * @module drone-detail/cameras/CameraThumbnail
 * @description A small, self-contained live preview for one camera. Opens its
 * OWN WHEP peer connection to the camera's resolved WHEP URL (mirroring the
 * cockpit's LAN-direct handshake) so a thumbnail never touches the single global
 * video session. Best-effort: with no URL, no WebRTC support, or on any failure
 * it renders nothing and the card shows a static placeholder instead.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  applyJitterTarget,
  NEGOTIATED_JITTER_TARGET_MS,
} from "@/lib/video/webrtc/jitter-controller";

/** Resolve once ICE gathering completes, or after a short cap (a LAN peer
 * gathers host candidates almost immediately). */
function waitIceComplete(pc: RTCPeerConnection): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === "complete") {
      resolve();
      return;
    }
    const check = () => {
      if (pc.iceGatheringState === "complete") {
        pc.removeEventListener("icegatheringstatechange", check);
        resolve();
      }
    };
    pc.addEventListener("icegatheringstatechange", check);
    setTimeout(resolve, 1500);
  });
}

export function CameraThumbnail({
  whepUrl,
  className,
}: {
  /** Fully-resolved WHEP URL, or null/undefined when none is known. */
  whepUrl?: string | null;
  className?: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  // Only open the WHEP peer connection once the card is on-screen, so a long
  // roster does not eagerly spin up N RTCPeerConnections for cards the operator
  // never scrolls to. Once visible it stays open. Falls open where the observer
  // is unavailable (test / older runtimes).
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setVisible(true);
      },
      { rootMargin: "150px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    setPlaying(false);
    if (!visible || !whepUrl || typeof RTCPeerConnection === "undefined") return;

    let cancelled = false;
    let pc: RTCPeerConnection | null = null;
    const video = videoRef.current;

    (async () => {
      try {
        pc = new RTCPeerConnection({ iceServers: [] });
        pc.addTransceiver("video", { direction: "recvonly" });
        pc.ontrack = (event) => {
          const stream = event.streams[0];
          if (cancelled || !stream || !videoRef.current) return;
          videoRef.current.srcObject = stream;
          setPlaying(true);
        };
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await waitIceComplete(pc);
        if (cancelled) return;
        const res = await fetch(whepUrl, {
          method: "POST",
          headers: { "Content-Type": "application/sdp" },
          body: pc.localDescription?.sdp ?? offer.sdp,
        });
        if (!res.ok) throw new Error(`WHEP ${res.status}`);
        const answer = await res.text();
        if (cancelled) return;
        await pc.setRemoteDescription({ type: "answer", sdp: answer });
        // The negotiated receiver depth, at the one point it sticks. A
        // thumbnail on the browser default ran deeper than every other
        // surface showing the same camera.
        applyJitterTarget(pc, NEGOTIATED_JITTER_TARGET_MS);
      } catch {
        // Best-effort preview: the card falls back to its placeholder.
        if (!cancelled) setPlaying(false);
      }
    })();

    return () => {
      cancelled = true;
      if (video) video.srcObject = null;
      if (pc) {
        try {
          pc.close();
        } catch {
          // already closed
        }
      }
    };
  }, [whepUrl, visible]);

  return (
    <video
      ref={videoRef}
      muted
      autoPlay
      playsInline
      aria-hidden
      className={cn(
        "h-full w-full object-cover transition-opacity",
        playing ? "opacity-100" : "opacity-0",
        className,
      )}
    />
  );
}
