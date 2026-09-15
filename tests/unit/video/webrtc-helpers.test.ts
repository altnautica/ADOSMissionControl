/**
 * Unit tests for the pure helpers inside webrtc-client.
 *
 * These cover error classification, abort plumbing, SDP munging, and the
 * URL-based transport classifier. They run without a browser RTCPeerConnection,
 * so we are exercising only the deterministic helpers, not the lifecycle.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import {
  classifyError,
  checkAborted,
  abortable,
  mungeForLowLatency,
} from "@/lib/video/webrtc-client";

describe("classifyError", () => {
  it("maps a native AbortError to aborted", () => {
    const err = new DOMException("Aborted", "AbortError");
    expect(classifyError(err).code).toBe("aborted");
  });

  it("maps a thrown string containing 'cancelled' to aborted", () => {
    expect(classifyError("Operation cancelled by user").code).toBe("aborted");
  });

  it("maps cascade-level timeouts to cascade-timeout", () => {
    expect(classifyError(new Error("LAN Direct timeout after 4000ms")).code).toBe("cascade-timeout");
    expect(classifyError(new Error("P2P MQTT timeout after 14000ms")).code).toBe("cascade-timeout");
  });

  it("maps ICE gather timeouts to ice-gather-timeout", () => {
    expect(classifyError(new Error("ICE gather timed out")).code).toBe("ice-gather-timeout");
  });

  it("maps ICE disconnect to ice-disconnect", () => {
    expect(classifyError(new Error("ICE peer disconnect")).code).toBe("ice-disconnect");
  });

  it("maps MQTT timeouts to mqtt-answer-timeout", () => {
    expect(classifyError(new Error("MQTT answer timeout after 12s")).code).toBe("mqtt-answer-timeout");
  });

  it("maps MQTT broker connect failures to mqtt-connect-timeout", () => {
    expect(classifyError(new Error("MQTT broker connect refused")).code).toBe("mqtt-connect-timeout");
  });

  it("maps MQTT subscribe failures to mqtt-subscribe-failed", () => {
    expect(classifyError(new Error("subscribe error: NACK")).code).toBe("mqtt-subscribe-failed");
  });

  it("maps ontrack timeouts to ontrack-timeout", () => {
    expect(classifyError(new Error("ontrack never fired")).code).toBe("ontrack-timeout");
    expect(classifyError(new Error("video track missing")).code).toBe("ontrack-timeout");
  });

  it("maps WHEP 4xx errors to whep-4xx", () => {
    expect(classifyError(new Error("WHEP returned 404 not found")).code).toBe("whep-4xx");
  });

  it("maps WHEP 5xx errors to whep-5xx", () => {
    expect(classifyError(new Error("WHEP returned 503 service unavailable")).code).toBe("whep-5xx");
  });

  it("maps generic network failures to whep-network", () => {
    expect(classifyError(new Error("network request failed")).code).toBe("whep-network");
    expect(classifyError(new Error("fetch error")).code).toBe("whep-network");
  });

  it("maps anything else to other", () => {
    expect(classifyError(new Error("kaboom")).code).toBe("other");
    expect(classifyError(42).code).toBe("other");
  });

  it("preserves the original message text in the result", () => {
    const r = classifyError(new Error("WHEP returned 404 not found"));
    expect(r.message).toContain("404");
  });
});

describe("checkAborted", () => {
  it("does nothing when signal is undefined", () => {
    expect(() => checkAborted(undefined)).not.toThrow();
  });

  it("does nothing when signal has not aborted", () => {
    const ctrl = new AbortController();
    expect(() => checkAborted(ctrl.signal)).not.toThrow();
  });

  it("throws an AbortError DOMException when the signal has aborted", () => {
    const ctrl = new AbortController();
    ctrl.abort();
    let caught: unknown;
    try {
      checkAborted(ctrl.signal);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(DOMException);
    expect((caught as DOMException).name).toBe("AbortError");
  });
});

describe("abortable", () => {
  it("resolves when the wrapped promise resolves first", async () => {
    const ctrl = new AbortController();
    const p = Promise.resolve(42);
    await expect(abortable(p, ctrl.signal)).resolves.toBe(42);
  });

  it("rejects with AbortError when the signal fires before the promise settles", async () => {
    const ctrl = new AbortController();
    const p = new Promise<number>((resolve) => setTimeout(() => resolve(1), 50));
    setTimeout(() => ctrl.abort(), 5);
    let caught: unknown;
    try {
      await abortable(p, ctrl.signal);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(DOMException);
    expect((caught as DOMException).name).toBe("AbortError");
  });

  it("rejects immediately when the signal is already aborted", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const p = Promise.resolve(1);
    await expect(abortable(p, ctrl.signal)).rejects.toBeInstanceOf(DOMException);
  });

  it("returns the original promise when no signal is provided", async () => {
    const original = Promise.resolve("hi");
    const wrapped = abortable(original);
    expect(wrapped).toBe(original);
  });
});

describe("mungeForLowLatency", () => {
  it("inserts the conference flag after the first video m-line", () => {
    const sdp = "v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=rtpmap:96 H264/90000\r\n";
    const out = mungeForLowLatency(sdp);
    expect(out).toContain("a=x-google-flag:conference");
    const lines = out.split("\r\n");
    const mIdx = lines.findIndex((l) => l.startsWith("m=video"));
    expect(lines[mIdx + 1]).toBe("a=x-google-flag:conference");
  });

  it("is idempotent when the flag is already present", () => {
    const sdp = "m=video 9 UDP/TLS/RTP/SAVPF 96\r\na=x-google-flag:conference\r\na=rtpmap:96 H264/90000\r\n";
    expect(mungeForLowLatency(sdp)).toBe(sdp);
  });

  it("returns the SDP unchanged when no video m-line is present", () => {
    const sdp = "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n";
    expect(mungeForLowLatency(sdp)).toBe(sdp);
  });
});
