/**
 * The plugin confirm seam presents one request at a time, in arrival order,
 * and lets each plugin hold at most one.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  requestPluginConfirm,
  setPluginConfirmHandler,
  type PluginConfirmRequest,
} from "@/lib/plugins/confirm";

function req(pluginId: string, title = "t"): PluginConfirmRequest {
  return { pluginId, targetName: "Drone 1", targetId: "d1", title, body: "b" };
}

/** A host that records what it shows and lets the test answer it. */
function manualHost() {
  const shown: Array<{ req: PluginConfirmRequest; answer: (ok: boolean) => void }> = [];
  setPluginConfirmHandler((r) => {
    const { promise, resolve } = Promise.withResolvers<boolean>();
    shown.push({ req: r, answer: resolve });
    return promise;
  });
  return shown;
}

afterEach(() => {
  setPluginConfirmHandler(null);
});

describe("plugin confirm queue", () => {
  it("keeps the shown request when another plugin asks, and shows the next after an answer", async () => {
    const shown = manualHost();
    const first = requestPluginConfirm(req("plugin.a", "land"));
    const second = requestPluginConfirm(req("plugin.b", "takeoff"));

    // Only the first is on screen; the second waits instead of replacing it.
    expect(shown.map((s) => s.req.title)).toEqual(["land"]);

    shown[0].answer(true);
    await expect(first).resolves.toBe("approved");
    expect(shown.map((s) => s.req.title)).toEqual(["land", "takeoff"]);

    shown[1].answer(false);
    await expect(second).resolves.toBe("denied");
  });

  it("answers a second request from the same plugin as busy without showing it", async () => {
    const shown = manualHost();
    const first = requestPluginConfirm(req("plugin.a", "land"));
    await expect(requestPluginConfirm(req("plugin.a", "rtl"))).resolves.toBe("busy");
    expect(shown).toHaveLength(1);

    shown[0].answer(true);
    await expect(first).resolves.toBe("approved");
    // Once answered, the plugin may ask again.
    const again = requestPluginConfirm(req("plugin.a", "rtl"));
    expect(shown.map((s) => s.req.title)).toEqual(["land", "rtl"]);
    shown[1].answer(true);
    await expect(again).resolves.toBe("approved");
  });

  it("denies the shown and queued requests when the host unmounts", async () => {
    manualHost();
    const first = requestPluginConfirm(req("plugin.a"));
    const second = requestPluginConfirm(req("plugin.b"));
    setPluginConfirmHandler(null);
    await expect(first).resolves.toBe("denied");
    await expect(second).resolves.toBe("denied");
  });
});
