/**
 * Pure helpers for the WebRTC client.
 *
 * Lives apart from webrtc-client.ts so the client itself can stay focused
 * on RTCPeerConnection lifecycle. Every function here is deterministic
 * (no module-level state, no browser-API side effects beyond reading a URL)
 * which makes them unit-testable without a peer connection.
 *
 * @license GPL-3.0-only
 */

import type { TransportErrorCode } from "@/stores/video-store";

/**
 * Munge SDP to hint Chrome for minimum jitter buffer. The
 * `a=x-google-flag:conference` attribute tells Chrome's WebRTC stack to
 * prioritize low latency over smooth playout, reducing the default
 * 100-200ms adaptive jitter buffer to its minimum. Applied to the video
 * m-section.
 */
export function mungeForLowLatency(sdp: string): string {
  if (sdp.includes("a=x-google-flag:conference")) return sdp;
  return sdp.replace(
    /(m=video[^\r\n]*\r\n)/,
    "$1a=x-google-flag:conference\r\n",
  );
}

/**
 * Helper for AbortSignal-driven cancellation. Throws an AbortError that
 * `classifyError` then maps to `{ code: "aborted" }`.
 */
export function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
}

/**
 * Race a promise against an AbortSignal. The promise itself cannot be
 * aborted (no AbortablePromise in JS) but we can reject early when the
 * signal fires.
 */
export function abortable<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p;
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(
      (v) => { signal.removeEventListener("abort", onAbort); resolve(v); },
      (e) => { signal.removeEventListener("abort", onAbort); reject(e); },
    );
  });
}

/**
 * Classify a thrown error into a TransportErrorCode based on its message.
 * Lets the dropdown tooltip surface "ICE timeout" instead of raw stack
 * traces. Order matters: most specific patterns first.
 */
export function classifyError(err: unknown): { code: TransportErrorCode; message: string } {
  if (err instanceof DOMException && err.name === "AbortError") {
    return { code: "aborted", message: "Cancelled" };
  }
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();
  if (lower.includes("aborted") || lower.includes("cancelled")) {
    return { code: "aborted", message };
  }
  // Cascade-level timeouts come from withTimeout in the cascade hook and
  // look like "LAN Direct timeout after 4000ms" or "P2P MQTT timeout after 14000ms"
  if (lower.match(/^(lan direct|p2p mqtt|cloud whep|cloud mse) timeout/)) {
    return { code: "cascade-timeout", message };
  }
  if (lower.includes("ice gather") || lower.includes("ice gathering")) {
    return { code: "ice-gather-timeout", message };
  }
  if (lower.includes("disconnect") && lower.includes("ice")) {
    return { code: "ice-disconnect", message };
  }
  if (lower.includes("mqtt") && lower.includes("timeout")) {
    return { code: "mqtt-answer-timeout", message };
  }
  if (lower.includes("mqtt broker connect")) {
    return { code: "mqtt-connect-timeout", message };
  }
  if (lower.includes("subscribe")) {
    return { code: "mqtt-subscribe-failed", message };
  }
  if (lower.includes("ontrack") || lower.includes("video track")) {
    return { code: "ontrack-timeout", message };
  }
  // WHEP HTTP status, check status code in message.
  if (/4\d\d/.test(message) && lower.includes("whep")) {
    return { code: "whep-4xx", message };
  }
  if (/5\d\d/.test(message) && lower.includes("whep")) {
    return { code: "whep-5xx", message };
  }
  if (lower.includes("network") || lower.includes("fetch")) {
    return { code: "whep-network", message };
  }
  return { code: "other", message };
}

