/**
 * Tests for the read-only `ctx.perception.*` plugin handlers: read returns the
 * selection-scoped perception state, health composes the honest feed/session
 * readout, subscribe streams the drone's live detection batches to the iframe,
 * and the bridge rejects a caller that lacks the `perception.read` capability.
 * The method-rule map is asserted alongside.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import { buildPerceptionHandlers } from "../perception";
import {
  createPluginBridge,
  type BridgeHandlerContext,
} from "@/lib/plugins/bridge";
import { resolveRequiredCapability } from "@/lib/plugins/methods";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import {
  useVisionDetectionsStore,
  type VisionDetectionBatch,
} from "@/stores/vision-detections-store";
import type { PluginRpcEnvelope } from "@/lib/plugins/types";
import { testMount } from "./test-mount";

const DEVICE = "d1";

const BATCH: Omit<VisionDetectionBatch, "receivedAt"> = {
  modelId: "com.example.people",
  cameraId: "uvc-0",
  frameId: 1,
  tsMs: 0,
  frameWidth: 640,
  frameHeight: 480,
  detections: [
    {
      bbox: { x: 1, y: 2, width: 3, height: 4 },
      classLabel: "person",
      confidence: 0.9,
      trackId: 5,
      assocConfidence: 0.8,
      lockState: "locked",
      attributes: null,
    },
  ],
};

const MOUNT = testMount();

function makeCtx(
  capability: string,
  postEvent = vi.fn(),
): BridgeHandlerContext {
  return {
    pluginId: "com.altnautica.demo",
    capability,
    postEvent,
    mount: MOUNT,
    claims: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useVisionDetectionsStore.getState().clear();
  useAgentCapabilitiesStore.setState({
    perceptionTier: undefined,
    perceptionOffloadTarget: undefined,
    npuTops: undefined,
    hasAccelerator: undefined,
  });
});

describe("perception.read", () => {
  it("returns the selection-scoped perception state", async () => {
    useAgentCapabilitiesStore.setState({
      perceptionTier: "offload",
      perceptionOffloadTarget: "workstation.local:8092",
      npuTops: 6,
      hasAccelerator: true,
    });
    const { handlers } = buildPerceptionHandlers(DEVICE);
    const res = await handlers["perception.read"]({}, makeCtx("perception.read"));
    expect(res).toEqual({
      tier: "offload",
      offloadTarget: "workstation.local:8092",
      npuTops: 6,
      hasAccelerator: true,
    });
  });

  it("reads null for absent fields (never fabricates)", async () => {
    const { handlers } = buildPerceptionHandlers(DEVICE);
    const res = await handlers["perception.read"]({}, makeCtx("perception.read"));
    expect(res).toEqual({
      tier: null,
      offloadTarget: null,
      npuTops: null,
      hasAccelerator: null,
    });
  });
});

describe("perception.health", () => {
  it("composes a live session over a fresh batch", async () => {
    useAgentCapabilitiesStore.setState({
      perceptionTier: "local",
      perceptionOffloadTarget: null,
    });
    useVisionDetectionsStore.getState().setBatch(DEVICE, BATCH);
    const { handlers } = buildPerceptionHandlers(DEVICE);
    const res = (await handlers["perception.health"](
      {},
      makeCtx("perception.read"),
    )) as Record<string, unknown>;
    expect(res.feed).toBe("fresh");
    expect(res.session).toBe("live");
    expect(typeof res.ageMs).toBe("number");
    // A single batch is too sparse to call a rate honestly (no fabricated reading).
    expect(res.batchesPerSecond).toBeNull();
    expect(res.boundNode).toBeNull();
  });

  it("reports a closed session with no feed", async () => {
    const { handlers } = buildPerceptionHandlers(DEVICE);
    const res = (await handlers["perception.health"](
      {},
      makeCtx("perception.read"),
    )) as Record<string, unknown>;
    expect(res.feed).toBe("idle");
    expect(res.session).toBe("closed");
    expect(res.ageMs).toBeNull();
  });
});

describe("perception.subscribe", () => {
  it("pushes each fresh batch for the bound drone as a host event", () => {
    const postEvent = vi.fn();
    const { handlers, dispose } = buildPerceptionHandlers(DEVICE);
    handlers["perception.subscribe"]({}, makeCtx("perception.subscribe", postEvent));

    useVisionDetectionsStore.getState().setBatch(DEVICE, BATCH);
    expect(postEvent).toHaveBeenCalledTimes(1);
    const [method, capability, payload] = postEvent.mock.calls[0];
    expect(method).toBe("perception.detections");
    expect(capability).toBe("perception.subscribe");
    const p = payload as { modelId: string; detections: unknown[] };
    expect(p.modelId).toBe("com.example.people");
    expect(p.detections).toHaveLength(1);

    // A batch for a different drone must not fire this subscription.
    useVisionDetectionsStore.getState().setBatch("other", BATCH);
    expect(postEvent).toHaveBeenCalledTimes(1);

    // After dispose no further batches are forwarded.
    dispose();
    useVisionDetectionsStore.getState().setBatch(DEVICE, BATCH);
    expect(postEvent).toHaveBeenCalledTimes(1);
  });

  it("throws when the plugin has no scoped drone", () => {
    const { handlers } = buildPerceptionHandlers(null);
    expect(() =>
      handlers["perception.subscribe"]({}, makeCtx("perception.subscribe")),
    ).toThrow(/scoped drone/);
  });
});

describe("bridge capability gate for ctx.perception", () => {
  function setup(granted: string[]) {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const win = iframe.contentWindow as Window;
    const posted: PluginRpcEnvelope[] = [];
    win.postMessage = ((msg: PluginRpcEnvelope) => {
      posted.push(msg);
    }) as typeof win.postMessage;
    const { handlers } = buildPerceptionHandlers(DEVICE);
    const bridge = createPluginBridge({
      pluginId: "com.altnautica.demo",
      grantedCapabilities: new Set<string>(granted),
      iframe,
      handlers,
    });
    return { bridge, win, posted, iframe };
  }

  const req = (method: string, capability: string): PluginRpcEnvelope => ({
    id: "1",
    type: "request",
    method,
    capability,
    args: {},
    version: 1,
  });

  it("rejects perception.read when the plugin lacks the capability", async () => {
    const { bridge, win, posted } = setup([]);
    await bridge.handleEnvelope(req("perception.read", "perception.read"), win);
    expect(posted).toHaveLength(1);
    expect(posted[0].error?.code).toBe("permission_denied");
    bridge.dispose();
  });

  it("runs perception.read when the plugin holds the capability", async () => {
    useAgentCapabilitiesStore.setState({ perceptionTier: "local" });
    const { bridge, win, posted } = setup(["perception.read"]);
    await bridge.handleEnvelope(req("perception.read", "perception.read"), win);
    expect(posted).toHaveLength(1);
    expect(posted[0].error).toBeUndefined();
    expect((posted[0].args as { tier: string }).tier).toBe("local");
    bridge.dispose();
  });
});

describe("perception method rules", () => {
  it("resolves each perception method to its capability", () => {
    expect(resolveRequiredCapability("perception.read", {})).toBe(
      "perception.read",
    );
    expect(resolveRequiredCapability("perception.subscribe", {})).toBe(
      "perception.subscribe",
    );
    // health is a read; unsubscribe needs no grant.
    expect(resolveRequiredCapability("perception.health", {})).toBe(
      "perception.read",
    );
    expect(resolveRequiredCapability("perception.unsubscribe", {})).toBeNull();
  });
});
