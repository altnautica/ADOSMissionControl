/**
 * @license GPL-3.0-only
 *
 * Immersive mode owns two platform resources: fullscreen and a screen wake
 * lock. Leaving fullscreen with Esc (which the browser consumes) must end the
 * mode, and a wake lock granted after the mode ended must not be kept.
 */

import { describe, it, expect, vi, afterEach } from "vitest";

import { useUiStore } from "../ui-store";

afterEach(() => {
  useUiStore.getState().exitImmersiveMode();
  vi.unstubAllGlobals();
});

describe("ui-store immersive mode", () => {
  it("ends when the document leaves fullscreen", () => {
    useUiStore.getState().enterImmersiveMode();
    expect(useUiStore.getState().immersiveMode).toBe(true);

    document.dispatchEvent(new Event("fullscreenchange"));

    expect(useUiStore.getState().immersiveMode).toBe(false);
  });

  it("releases a wake lock granted after the mode already ended", async () => {
    const release = vi.fn(async () => {});
    const { promise, resolve } = Promise.withResolvers<{ released: boolean; release: () => Promise<void> }>();
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: { request: () => promise },
    });

    useUiStore.getState().enterImmersiveMode();
    useUiStore.getState().exitImmersiveMode();
    resolve({ released: false, release });
    await promise;
    await Promise.resolve();

    expect(release).toHaveBeenCalledTimes(1);
  });
});
