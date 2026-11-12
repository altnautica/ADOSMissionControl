/**
 * Waypoint number labels draw only after their glyphs reach the texture atlas,
 * a frame or more after the label is added. Under on-demand rendering the scene
 * must keep painting until then, or the numbers stay invisible until the camera
 * next moves.
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi } from "vitest";
import type { Viewer } from "cesium";
import {
  MAX_SETTLE_FRAMES,
  entityGraphicsReady,
  keepRenderingUntilGraphicsReady,
} from "../render-until-graphics-ready";

function fakeViewer(clusterReady: () => boolean) {
  const listeners = new Set<() => void>();
  const requestRender = vi.fn();
  const viewer = {
    isDestroyed: () => false,
    dataSourceDisplay: {
      defaultDataSource: {
        clustering: {
          get ready() {
            return clusterReady();
          },
        },
      },
    },
    dataSources: { length: 0, get: () => undefined },
    scene: {
      requestRender,
      postRender: {
        addEventListener: (fn: () => void) => {
          listeners.add(fn);
          return () => listeners.delete(fn);
        },
      },
    },
  } as unknown as Viewer;
  const frame = () => listeners.forEach((fn) => fn());
  return { viewer, requestRender, frame, listeners };
}

describe("keepRenderingUntilGraphicsReady", () => {
  it("requests frames while labels are loading and stops once they can draw", () => {
    let ready = false;
    const { viewer, requestRender, frame } = fakeViewer(() => ready);
    keepRenderingUntilGraphicsReady(viewer);

    frame(); // the frame that added the labels: glyphs only queued
    frame(); // atlas still filling
    expect(requestRender).toHaveBeenCalledTimes(2);

    ready = true;
    frame(); // labels drawn
    expect(requestRender).toHaveBeenCalledTimes(2);
  });

  it("does nothing while the scene is settled", () => {
    const { viewer, requestRender, frame } = fakeViewer(() => true);
    keepRenderingUntilGraphicsReady(viewer);
    frame();
    expect(requestRender).not.toHaveBeenCalled();
  });

  it("gives up after a bounded number of frames when graphics never settle", () => {
    const { viewer, requestRender, frame } = fakeViewer(() => false);
    keepRenderingUntilGraphicsReady(viewer);
    for (let i = 0; i < MAX_SETTLE_FRAMES + 50; i++) frame();
    expect(requestRender).toHaveBeenCalledTimes(MAX_SETTLE_FRAMES);
  });

  it("unsubscribes", () => {
    const { viewer, listeners } = fakeViewer(() => false);
    const stop = keepRenderingUntilGraphicsReady(viewer);
    expect(listeners.size).toBe(1);
    stop();
    expect(listeners.size).toBe(0);
  });

  it("treats a viewer without a data source display as ready", () => {
    expect(entityGraphicsReady({ dataSourceDisplay: undefined } as unknown as Viewer)).toBe(true);
  });
});
