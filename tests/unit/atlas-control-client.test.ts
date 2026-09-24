/**
 * Tests for the Atlas capture-control client: defensive coercion of the wire
 * shapes, direct-vs-proxy transport selection (HTTP vs HTTPS origin), the
 * snake_case config-patch mapping, and the 503 "capture service down" branch.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  AtlasControlClient,
  coerceReadiness,
  coerceCaptureStatus,
  isActiveCaptureState,
} from "@/lib/agent/atlas-control-client";

describe("isActiveCaptureState", () => {
  it("treats capturing / paused / finalizing as active sessions", () => {
    expect(isActiveCaptureState("capturing")).toBe(true);
    expect(isActiveCaptureState("paused")).toBe(true);
    expect(isActiveCaptureState("finalizing")).toBe(true);
  });

  it("treats idle / bagged / unknown as inactive", () => {
    expect(isActiveCaptureState("idle")).toBe(false);
    expect(isActiveCaptureState("bagged")).toBe(false);
    expect(isActiveCaptureState("")).toBe(false);
    expect(isActiveCaptureState("ended")).toBe(false);
  });
});

/** A minimal Response stand-in — the client only reads `status` + `json()`. */
function res(status: number, body: unknown): Response {
  return { status, json: async () => body } as unknown as Response;
}

const READINESS_WIRE = {
  enabled: true,
  profile: "drone",
  capture_profile: "balanced",
  reconstruct_steps: 15000,
  cameras_configured: 6,
  pose_source: "hybrid",
  service_running: true,
  capturing: true,
  state: "capturing",
  session_id: "atlas-123",
  camera_count: 6,
  keyframes: 42,
  ingest_rate_hz: 6.5,
};

describe("coerceReadiness", () => {
  it("maps snake_case wire fields to camelCase", () => {
    const r = coerceReadiness(READINESS_WIRE);
    expect(r).toEqual({
      enabled: true,
      profile: "drone",
      captureProfile: "balanced",
      reconstructSteps: 15000,
      camerasConfigured: 6,
      poseSource: "hybrid",
      serviceRunning: true,
      capturing: true,
      state: "capturing",
      sessionId: "atlas-123",
      cameraCount: 6,
      keyframes: 42,
      ingestRateHz: 6.5,
    });
  });

  it("reads fields the agent did not report as unknown, never as idle", () => {
    const r = coerceReadiness({});
    expect(r).toMatchObject({
      enabled: false,
      capturing: null,
      camerasConfigured: 0,
      poseSource: "local_vio",
      state: null,
      sessionId: null,
      ingestRateHz: null,
    });
  });

  it("returns null for a non-object body", () => {
    expect(coerceReadiness(null)).toBeNull();
    expect(coerceReadiness("nope")).toBeNull();
    expect(coerceReadiness([1, 2])).toBeNull();
  });
});

describe("coerceCaptureStatus", () => {
  it("maps the capture-status wire shape", () => {
    const s = coerceCaptureStatus({
      session_id: "s1",
      state: "paused",
      keyframes: 10,
      vio_health: "good",
      camera_count: 4,
      ingest_rate_hz: 3,
    });
    expect(s).toEqual({
      sessionId: "s1",
      state: "paused",
      keyframes: 10,
      vioHealth: "good",
      cameraCount: 4,
      ingestRateHz: 3,
    });
  });

  it("returns null for a non-object body", () => {
    expect(coerceCaptureStatus(undefined)).toBeNull();
  });
});

describe("AtlasControlClient (direct / HTTP origin)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Force a non-HTTPS origin so the client fetches the agent directly.
    vi.stubGlobal("location", { protocol: "http:", href: "http://x/", search: "" });
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("getReadiness GETs the agent directly with the key header", async () => {
    fetchMock.mockResolvedValue(res(200, READINESS_WIRE));
    const c = new AtlasControlClient("http://d.local:8080", "KEY");
    const r = await c.getReadiness();
    expect(r?.capturing).toBe(true);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("http://d.local:8080/api/atlas/readiness");
    expect(opts.method).toBe("GET");
    expect(opts.headers["X-ADOS-Key"]).toBe("KEY");
  });

  it("getReadiness returns null on a 404", async () => {
    fetchMock.mockResolvedValue(res(404, { error: "not found" }));
    const c = new AtlasControlClient("http://d.local:8080", "KEY");
    expect(await c.getReadiness()).toBeNull();
  });

  it("getReadiness returns null on a transport failure", async () => {
    fetchMock.mockRejectedValue(new Error("boom"));
    const c = new AtlasControlClient("http://d.local:8080", "KEY");
    expect(await c.getReadiness()).toBeNull();
  });

  it("setConfig PUTs and maps captureProfile -> capture_profile", async () => {
    fetchMock.mockResolvedValue(
      res(200, { status: "ok", enabled: true, restart: { ados_atlas: true } }),
    );
    const c = new AtlasControlClient("http://d.local:8080", "KEY");
    const out = await c.setConfig({ enabled: true, captureProfile: "fast" });
    expect(out).toEqual({
      ok: true,
      enabled: true,
      restart: { ados_atlas: true },
    });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("http://d.local:8080/api/atlas/config");
    expect(opts.method).toBe("PUT");
    expect(JSON.parse(opts.body)).toEqual({
      enabled: true,
      capture_profile: "fast",
    });
  });

  it("setConfig reports a failed service restart as a failure with its reason", async () => {
    fetchMock.mockResolvedValue(
      res(502, {
        status: "error",
        enabled: true,
        persisted: true,
        restart: { status: "error", message: "Restart timed out for ados-atlas" },
      }),
    );
    const c = new AtlasControlClient("http://d.local:8080", "KEY");
    expect(await c.setConfig({ enabled: true })).toEqual({
      ok: false,
      message: "Restart timed out for ados-atlas",
    });
  });

  it("setConfig's deadline covers the agent's service restart", async () => {
    // The agent restarts the capture service (up to ~35 s) before it answers
    // a config write; the 6 s read deadline aborted a write that then landed.
    const timeout = vi.spyOn(AbortSignal, "timeout");
    fetchMock.mockResolvedValue(res(200, { status: "ok", enabled: true, restart: { status: "ok" } }));
    const c = new AtlasControlClient("http://d.local:8080", "KEY");
    await c.setConfig({ enabled: true });
    expect(timeout).toHaveBeenCalledTimes(1);
    expect(timeout.mock.calls[0][0]).toBeGreaterThanOrEqual(40_000);
  });

  it("captureStart returns ok:true with the coerced status", async () => {
    fetchMock.mockResolvedValue(
      res(200, {
        session_id: "s9",
        state: "capturing",
        keyframes: 1,
        vio_health: "good",
        camera_count: 6,
        ingest_rate_hz: 6,
      }),
    );
    const c = new AtlasControlClient("http://d.local:8080", "KEY");
    const r = await c.captureStart();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.status.sessionId).toBe("s9");
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("http://d.local:8080/api/atlas/capture/start");
    expect(opts.method).toBe("POST");
  });

  it("capture action reports serviceDown on a 503", async () => {
    fetchMock.mockResolvedValue(res(503, { error: "service_unavailable" }));
    const c = new AtlasControlClient("http://d.local:8080", "KEY");
    const r = await c.captureStop();
    expect(r).toEqual({
      ok: false,
      serviceDown: true,
      message: "service_unavailable",
    });
  });

  it("capture action reports a non-503 failure without serviceDown", async () => {
    fetchMock.mockResolvedValue(res(500, { message: "boom" }));
    const c = new AtlasControlClient("http://d.local:8080", "KEY");
    const r = await c.capturePause();
    expect(r).toEqual({ ok: false, serviceDown: false, message: "boom" });
  });
});

describe("AtlasControlClient (proxy / HTTPS origin)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubGlobal("location", {
      protocol: "https:",
      href: "https://command/",
      search: "",
    });
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("routes readiness through /api/lan-pair/atlas with host+apiKey+path", async () => {
    fetchMock.mockResolvedValue(res(200, READINESS_WIRE));
    const c = new AtlasControlClient("http://d.local:8080", "KEY");
    const r = await c.getReadiness();
    expect(r?.capturing).toBe(true);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/lan-pair/atlas");
    expect(opts.method).toBe("POST");
    const sent = JSON.parse(opts.body);
    expect(sent).toMatchObject({
      host: "http://d.local:8080",
      apiKey: "KEY",
      path: "readiness",
      method: "GET",
    });
  });

  it("routes a capture action through the proxy (path capture/start)", async () => {
    fetchMock.mockResolvedValue(
      res(200, {
        session_id: "s1",
        state: "capturing",
        keyframes: 0,
        vio_health: "good",
        camera_count: 6,
        ingest_rate_hz: 6,
      }),
    );
    const c = new AtlasControlClient("http://d.local:8080", "KEY");
    await c.captureStart();
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.path).toBe("capture/start");
    expect(sent.method).toBe("POST");
  });
});
