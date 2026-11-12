/**
 * @module render-until-graphics-ready
 * @description Keeps an on-demand (`requestRenderMode`) Cesium scene painting
 * until its entity labels and billboards are ready to draw.
 *
 * Label glyphs and billboard images reach the GPU through an asynchronous
 * texture atlas: the frame that adds an entity only queues its glyphs, and they
 * become drawable a frame or more later. Nothing in Cesium requests that later
 * frame, so under `requestRenderMode` a waypoint number stayed invisible until
 * the camera next moved, although the entity and its label existed.
 * @license GPL-3.0-only
 */

import type { Viewer as CesiumViewer } from "cesium";

/** Upper bound on back-to-back frames requested while graphics never settle
 *  (an image that failed to load): about five seconds at 60 fps. */
export const MAX_SETTLE_FRAMES = 300;

/** `EntityCluster.ready` is not in Cesium's public typings. */
interface ReadyFlag {
  ready?: boolean;
}

/** True when every entity label and billboard of the viewer's data sources can draw. */
export function entityGraphicsReady(viewer: CesiumViewer): boolean {
  const display = viewer.dataSourceDisplay;
  if (!display) return true;
  const clusters: Array<ReadyFlag | undefined> = [
    display.defaultDataSource?.clustering as ReadyFlag | undefined,
  ];
  const sources = viewer.dataSources;
  for (let i = 0; i < (sources?.length ?? 0); i++) {
    clusters.push(sources.get(i).clustering as ReadyFlag | undefined);
  }
  return clusters.every((cluster) => cluster?.ready !== false);
}

/**
 * After every rendered frame, request another while entity graphics are still
 * loading. An idle scene renders nothing, so this costs nothing at rest.
 * Returns the unsubscribe function.
 */
export function keepRenderingUntilGraphicsReady(viewer: CesiumViewer): () => void {
  let pendingFrames = 0;
  return viewer.scene.postRender.addEventListener(() => {
    if (viewer.isDestroyed() || entityGraphicsReady(viewer)) {
      pendingFrames = 0;
      return;
    }
    if (pendingFrames >= MAX_SETTLE_FRAMES) return;
    pendingFrames += 1;
    viewer.scene.requestRender();
  });
}
