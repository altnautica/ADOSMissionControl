import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { VisionAgentClient } from "@/lib/agent/vision-client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("VisionAgentClient.getEngineStatus", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /api/vision/status with the auth header and coerces the models + telemetry", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        npu_utilization_pct: 63.5,
        model_count: 2,
        models: [
          {
            id: "yolov8n",
            kind: "detection",
            execution: "engine_run",
            backend_loaded: true,
            output_classes: ["person", "car"],
            fps: 24.5,
            latency_ms: 19.1,
            is_inference_capable: true,
          },
          {
            id: "osnet-reid",
            kind: "tracking",
            execution: "plugin_side",
            backend_loaded: false,
            output_classes: [],
          },
        ],
      }),
    );
    const client = new VisionAgentClient("http://drone.local:8080", "secret-key");

    const status = await client.getEngineStatus();

    expect(status).toEqual({
      known: true,
      npuUtilizationPct: 63.5,
      modelCount: 2,
      models: [
        {
          id: "yolov8n",
          kind: "detection",
          execution: "engine_run",
          backendLoaded: true,
          outputClasses: ["person", "car"],
          fps: 24.5,
          latencyMs: 19.1,
          isInferenceCapable: true,
        },
        {
          id: "osnet-reid",
          kind: "tracking",
          execution: "plugin_side",
          backendLoaded: false,
          outputClasses: [],
          fps: undefined,
          latencyMs: undefined,
          isInferenceCapable: undefined,
        },
      ],
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://drone.local:8080/api/vision/status");
    const headers = init.headers as Record<string, string>;
    expect(headers["X-ADOS-Key"]).toBe("secret-key");
  });

  it("hides NPU utilization (null) and falls back model_count to models.length when absent", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        models: [
          {
            id: "yolov8n",
            kind: "detection",
            execution: "engine_run",
            backend_loaded: true,
            output_classes: ["person"],
          },
        ],
      }),
    );
    const client = new VisionAgentClient("http://drone.local:8080");
    const status = await client.getEngineStatus();
    expect(status.npuUtilizationPct).toBeNull();
    expect(status.modelCount).toBe(1);
  });

  it("returns the empty status on a 404 (older agent, no engine read-back)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ detail: "not found" }, 404));
    const client = new VisionAgentClient("http://drone.local:8080");
    await expect(client.getEngineStatus()).resolves.toEqual({
      known: false,
      models: [],
      npuUtilizationPct: null,
      modelCount: 0,
    });
  });

  it("drops malformed entries and models with no id", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        models: [
          { kind: "detection" }, // no id -> dropped
          "not-an-object",
          {
            id: "ok",
            kind: "detection",
            execution: "engine_run",
            backend_loaded: true,
            output_classes: ["a"],
          },
        ],
      }),
    );
    const client = new VisionAgentClient("http://drone.local:8080");
    const status = await client.getEngineStatus();
    expect(status.models).toEqual([
      {
        id: "ok",
        kind: "detection",
        execution: "engine_run",
        backendLoaded: true,
        outputClasses: ["a"],
        fps: undefined,
        latencyMs: undefined,
        isInferenceCapable: undefined,
      },
    ]);
  });

  it("throws on a non-ok, non-404 response", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ detail: "vision engine unavailable" }, 503),
    );
    const client = new VisionAgentClient("http://drone.local:8080");
    await expect(client.getEngineStatus()).rejects.toThrow();
  });
});
