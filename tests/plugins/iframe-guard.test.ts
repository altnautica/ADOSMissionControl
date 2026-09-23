/**
 * The plugin frame guard removes WebRTC from the frame's global and refuses
 * nested browsing contexts, which would hand the plugin a fresh global with
 * WebRTC restored. Runs the guard in this test file's own jsdom window.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { PLUGIN_FRAME_GUARD_SCRIPT } from "@/lib/plugins/iframe-csp";

type Global = Record<string, unknown>;

beforeAll(() => {
  const g = window as unknown as Global;
  g.RTCPeerConnection = class {};
  g.webkitRTCPeerConnection = class {};
  g.RTCDataChannel = class {};
  // The test DOM does not count child browsing contexts; model a browser's
  // `window.length` as the number of connected frames.
  Object.defineProperty(window, "length", {
    configurable: true,
    get: () => document.querySelectorAll("iframe").length,
  });
  // The guard is a classic script evaluated in the frame's global scope.
  new Function(PLUGIN_FRAME_GUARD_SCRIPT)();
});

describe("plugin frame guard", () => {
  it("removes every WebRTC interface from the frame global", () => {
    const g = window as unknown as Global;
    expect(g.RTCPeerConnection).toBeUndefined();
    expect(g.webkitRTCPeerConnection).toBeUndefined();
    expect(g.RTCDataChannel).toBeUndefined();
  });

  it("removes a nested frame before the insertion call returns", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    host.appendChild(document.createElement("iframe"));
    expect(window.length).toBe(0);
    expect(document.querySelector("iframe")).toBeNull();

    host.innerHTML = "<iframe></iframe>";
    expect(window.length).toBe(0);
    expect(document.querySelector("iframe")).toBeNull();
  });
});
