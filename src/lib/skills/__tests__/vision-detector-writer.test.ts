/**
 * Tests for the live engine-detector write seam (`vision-detector-writer`):
 * the local-first guarantee that a write returns honestly (`false` /
 * `null`) when the drone has no LAN seam, and that a present seam routes the
 * write through Mission Control's own `/api/lan-pair/vision-*` proxy (so a
 * hosted HTTPS GCS dodges the browser mixed-content guard). `local-nodes-store`
 * and `fetch` are mocked so the test is pure of network + browser storage.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let nodes: Array<{ deviceId: string; hostname: string; apiKey: string }> = [];
vi.mock("@/stores/local-nodes-store", () => ({
  useLocalNodesStore: { getState: () => ({ nodes }) },
}));

import { setEngineDetector, uploadEngineModel } from "../vision-detector-writer";

const NODE = {
  deviceId: "d1",
  hostname: "http://drone.local:8080",
  apiKey: "k",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("vision-detector-writer", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    nodes = [];
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("setEngineDetector", () => {
    it("returns false (no fetch) when the drone has no LAN seam", async () => {
      const ok = await setEngineDetector({ droneId: "d1", modelId: "m1" });
      expect(ok).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("routes the write through the vision-detector proxy with host/key/model", async () => {
      nodes = [NODE];
      // The agent's detector reply (routes/vision_detector.rs restart_reply).
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ status: "ok", model_id: "m1", restart: { status: "ok" } }),
      );

      const ok = await setEngineDetector({ droneId: "d1", modelId: "m1" });
      expect(ok).toBe(true);

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("/api/lan-pair/vision-detector");
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body as string)).toEqual({
        host: NODE.hostname,
        apiKey: NODE.apiKey,
        modelId: "m1",
      });
    });

    it("throws on a proxy/transport error so the caller surfaces the reason", async () => {
      nodes = [NODE];
      fetchMock.mockResolvedValueOnce(
        new Response("upstream_unreachable", { status: 502 }),
      );
      await expect(
        setEngineDetector({ droneId: "d1", modelId: "m1" }),
      ).rejects.toThrow(/upstream_unreachable/);
    });

    it("throws the restart reason when the engine did not restart onto the model", async () => {
      // The detector was written but the engine keeps running the old model.
      nodes = [NODE];
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: "error",
            model_id: "m1",
            restart: { status: "error", message: "Restart timed out for ados-vision" },
          }),
          { status: 502, headers: { "Content-Type": "application/json" } },
        ),
      );
      await expect(
        setEngineDetector({ droneId: "d1", modelId: "m1" }),
      ).rejects.toThrow(/^Restart timed out for ados-vision$/);
    });

    it("does not accept a 2xx ok envelope whose restart failed", async () => {
      nodes = [NODE];
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          status: "ok",
          model_id: "m1",
          restart: { status: "error", message: "Restart timed out for ados-vision" },
        }),
      );
      await expect(
        setEngineDetector({ droneId: "d1", modelId: "m1" }),
      ).rejects.toThrow("Restart timed out for ados-vision");
    });

    it("does not accept a 2xx reply whose status is not ok", async () => {
      nodes = [NODE];
      fetchMock.mockResolvedValueOnce(jsonResponse({ status: "error", message: "model not installed" }));
      await expect(
        setEngineDetector({ droneId: "d1", modelId: "m1" }),
      ).rejects.toThrow("model not installed");
    });
  });

  describe("uploadEngineModel", () => {
    const META = {
      name: "My model",
      classes: ["person"],
      head: "yolov8",
      inputWidth: 640,
      inputHeight: 640,
      runtime: "onnx",
      boardMatch: ["rpi4b"],
    };
    const file = () =>
      new File([new Uint8Array([1, 2, 3])], "model.onnx", {
        type: "application/octet-stream",
      });

    it("returns null (no fetch) when the drone has no LAN seam", async () => {
      const res = await uploadEngineModel({
        droneId: "d1",
        file: file(),
        meta: META,
      });
      expect(res).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("routes the upload through the vision-upload proxy with routing fields", async () => {
      nodes = [NODE];
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ model_id: "custom-7", verified: true }),
      );

      const res = await uploadEngineModel({
        droneId: "d1",
        file: file(),
        meta: META,
      });
      expect(res).toEqual({ modelId: "custom-7", verified: true });

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("/api/lan-pair/vision-upload");
      expect(init.method).toBe("POST");
      const form = init.body as FormData;
      expect(form.get("host")).toBe(NODE.hostname);
      expect(form.get("apiKey")).toBe(NODE.apiKey);
      expect(form.get("file")).toBeInstanceOf(File);
      expect(JSON.parse(form.get("metadata") as string)).toEqual({
        name: "My model",
        classes: ["person"],
        head: "yolov8",
        input_w: 640,
        input_h: 640,
        runtime: "onnx",
        board_match: ["rpi4b"],
      });
    });

    it("returns modelId null + verified false when the agent omits them", async () => {
      nodes = [NODE];
      fetchMock.mockResolvedValueOnce(jsonResponse({}));
      const res = await uploadEngineModel({
        droneId: "d1",
        file: file(),
        meta: META,
      });
      expect(res).toEqual({ modelId: null, verified: false });
    });

    it("throws on a proxy/transport error", async () => {
      nodes = [NODE];
      fetchMock.mockResolvedValueOnce(
        new Response("upstream_unreachable", { status: 502 }),
      );
      await expect(
        uploadEngineModel({ droneId: "d1", file: file(), meta: META }),
      ).rejects.toThrow(/upstream_unreachable/);
    });
  });
});
