/**
 * Tests for the composited cockpit draw-layer handlers: a plugin posting
 * `cockpit.marks` writes validated, source-namespaced marks into the shared
 * marks store (composited by `CockpitMarkLayer`); `cockpit.marks.clear` +
 * `dispose()` drop them; and the bridge gates the `ui.slot.video-overlay`
 * capability before a mark post runs. The method-rule map is asserted too.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import { buildMarksHandlers, MARKS_MIN_INTERVAL_MS, pluginMarkSourceId } from "../marks";
import {
  createPluginBridge,
  type BridgeHandlerContext,
} from "@/lib/plugins/bridge";
import { resolveRequiredCapability } from "@/lib/plugins/methods";
import { useCockpitMarksStore } from "@/stores/cockpit-marks-store";
import type { PluginRpcEnvelope } from "@/lib/plugins/types";
import { testMount } from "./test-mount";

const PLUGIN = "com.example.overlay";
const MOUNT = testMount();
const SOURCE = pluginMarkSourceId(PLUGIN, MOUNT.id);

function makeCtx(capability: string | null, mount = MOUNT): BridgeHandlerContext {
  return { pluginId: PLUGIN, capability, postEvent: vi.fn(), mount, claims: null };
}

describe("cockpit marks handlers", () => {
  beforeEach(() => {
    const { bySource, clearSource } = useCockpitMarksStore.getState();
    for (const id of [...bySource.keys()]) clearSource(id);
  });

  it("cockpit.marks writes validated, source-namespaced marks into the store", () => {
    const { handlers } = buildMarksHandlers(PLUGIN);
    const res = handlers["cockpit.marks"](
      {
        marks: [
          { kind: "box", id: "blob", x: 1, y: 2, width: 3, height: 4 },
          { kind: "bad" }, // dropped by the parser
        ],
      },
      makeCtx("ui.slot.video-overlay"),
    ) as { ok: boolean; count: number };
    expect(res).toEqual({ ok: true, count: 1 });
    const stored = useCockpitMarksStore.getState().bySource.get(SOURCE);
    expect(stored).toHaveLength(1);
    // Ids are namespaced by source so two plugins never collide.
    expect(stored?.[0].id).toBe(`${SOURCE}::blob`);
  });

  it("coalesces rapid posts: the latest set lands once the minimum gap passes", () => {
    vi.useFakeTimers();
    try {
      const { handlers } = buildMarksHandlers(PLUGIN);
      const ctx = makeCtx("ui.slot.video-overlay");
      let writes = 0;
      const unsub = useCockpitMarksStore.subscribe(() => {
        writes += 1;
      });
      for (let i = 0; i < 100; i++) {
        handlers["cockpit.marks"]({ marks: [{ kind: "point", id: `p${i}`, x: 0, y: 0 }] }, ctx);
      }
      expect(useCockpitMarksStore.getState().bySource.get(SOURCE)?.map((m) => m.id)).toEqual([
        `${SOURCE}::p0`,
      ]);
      vi.advanceTimersByTime(MARKS_MIN_INTERVAL_MS);
      unsub();
      expect(useCockpitMarksStore.getState().bySource.get(SOURCE)?.map((m) => m.id)).toEqual([
        `${SOURCE}::p99`,
      ]);
      expect(writes).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cockpit.marks.clear and dispose() drop the plugin's marks", () => {
    const built = buildMarksHandlers(PLUGIN);
    built.handlers["cockpit.marks"](
      { marks: [{ kind: "point", id: "a", x: 0, y: 0 }] },
      makeCtx("ui.slot.video-overlay"),
    );
    built.handlers["cockpit.marks.clear"]({}, makeCtx(null));
    expect(useCockpitMarksStore.getState().bySource.has(SOURCE)).toBe(false);

    built.handlers["cockpit.marks"](
      { marks: [{ kind: "point", id: "a", x: 0, y: 0 }] },
      makeCtx("ui.slot.video-overlay"),
    );
    built.dispose();
    expect(useCockpitMarksStore.getState().bySource.has(SOURCE)).toBe(false);
  });

  it("two plugins' marks never collide in the composited store", () => {
    const a = buildMarksHandlers("plugin.a");
    const b = buildMarksHandlers("plugin.b");
    a.handlers["cockpit.marks"](
      { marks: [{ kind: "point", id: "same", x: 0, y: 0 }] },
      { pluginId: "plugin.a", capability: "ui.slot.video-overlay", postEvent: vi.fn(), mount: testMount(), claims: null },
    );
    b.handlers["cockpit.marks"](
      { marks: [{ kind: "point", id: "same", x: 1, y: 1 }] },
      { pluginId: "plugin.b", capability: "ui.slot.video-overlay", postEvent: vi.fn(), mount: testMount(), claims: null },
    );
    const all = useCockpitMarksStore.getState().all();
    const ids = all.map((m) => m.id);
    expect(new Set(ids).size).toBe(2);
  });
});

describe("cockpit marks method rules", () => {
  it("cockpit.marks is gated on the video-overlay slot capability", () => {
    expect(resolveRequiredCapability("cockpit.marks", {})).toBe(
      "ui.slot.video-overlay",
    );
  });

  it("cockpit.marks.clear is always allowed", () => {
    expect(resolveRequiredCapability("cockpit.marks.clear", {})).toBeNull();
  });
});

describe("cockpit.marks through the bridge (capability gate)", () => {
  function bridgeFor(granted: string[]) {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const posted: PluginRpcEnvelope[] = [];
    Object.defineProperty(iframe, "contentWindow", {
      value: { postMessage: (env: PluginRpcEnvelope) => posted.push(env) },
      configurable: true,
    });
    const { handlers } = buildMarksHandlers(PLUGIN);
    const bridge = createPluginBridge({
      pluginId: PLUGIN,
      grantedCapabilities: new Set(granted),
      iframe,
      handlers,
    });
    return { iframe, posted, bridge };
  }

  beforeEach(() => {
    const { bySource, clearSource } = useCockpitMarksStore.getState();
    for (const id of [...bySource.keys()]) clearSource(id);
  });

  it("runs when the plugin holds ui.slot.video-overlay", async () => {
    const { iframe, posted, bridge } = bridgeFor(["ui.slot.video-overlay"]);
    await bridge.handleEnvelope(
      {
        id: "1",
        type: "request",
        method: "cockpit.marks",
        capability: "ui.slot.video-overlay",
        args: { marks: [{ kind: "point", id: "a", x: 0, y: 0 }] },
        version: 1,
      },
      iframe.contentWindow,
    );
    expect(posted[0]?.error).toBeUndefined();
    expect(useCockpitMarksStore.getState().all()).toHaveLength(1);
    // Unmounting the iframe clears the marks it posted.
    bridge.dispose();
    expect(useCockpitMarksStore.getState().all()).toHaveLength(0);
  });

  it("is denied when the plugin lacks the capability", async () => {
    const { iframe, posted, bridge } = bridgeFor([]); // no caps
    await bridge.handleEnvelope(
      {
        id: "2",
        type: "request",
        method: "cockpit.marks",
        capability: "ui.slot.video-overlay",
        args: { marks: [{ kind: "point", id: "a", x: 0, y: 0 }] },
        version: 1,
      },
      iframe.contentWindow,
    );
    expect(posted[0]?.error?.code).toBe("permission_denied");
    expect(useCockpitMarksStore.getState().bySource.has(SOURCE)).toBe(false);
    bridge.dispose();
  });
});
