/**
 * @license GPL-3.0-only
 *
 * Point-cloud framing: the clip planes must hold the whole cloud from the
 * framing distance and from the orbit zoom-out limit, however large the cloud,
 * and the renderer must follow its canvas when the pane resizes.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import type { PerspectiveCamera, WebGLRenderer } from "three";
import { followCanvasSize, frameCloud } from "../cloud-view";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("frameCloud", () => {
  it.each([0.2, 5, 400, 3000])("keeps a %s m-radius cloud inside the clip planes", (radius) => {
    const fit = frameCloud(radius);
    // The far side of the cloud from the framing position and from the
    // furthest the orbit controls allow.
    expect(fit.far).toBeGreaterThanOrEqual(fit.distance + radius);
    expect(fit.far).toBeGreaterThanOrEqual(fit.maxDistance + radius);
    expect(fit.near).toBeGreaterThan(0);
    expect(fit.near).toBeLessThan(fit.distance - radius);
  });
});

describe("followCanvasSize", () => {
  it("resizes the renderer and camera aspect when the canvas changes size", () => {
    let fire: () => void = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(cb: () => void) {
          fire = cb;
        }
        observe() {}
        disconnect = disconnect;
      },
    );
    const canvas = document.createElement("canvas");
    Object.defineProperty(canvas, "clientWidth", { value: 1200, configurable: true });
    Object.defineProperty(canvas, "clientHeight", { value: 400, configurable: true });
    const setSize = vi.fn();
    const updateProjectionMatrix = vi.fn();
    const renderer = { setSize } as unknown as WebGLRenderer;
    const camera = { aspect: 1, updateProjectionMatrix } as unknown as PerspectiveCamera;

    const stop = followCanvasSize(canvas, renderer, camera);
    fire();
    expect(setSize).toHaveBeenCalledWith(1200, 400, false);
    expect(camera.aspect).toBe(3);
    expect(updateProjectionMatrix).toHaveBeenCalled();

    stop();
    expect(disconnect).toHaveBeenCalled();
  });
});
