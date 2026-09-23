/**
 * @module atlas/viewers/cloud-view
 * @description Camera framing and canvas sizing shared by the point-cloud
 * viewers. The clip planes are fitted to the cloud's bounding sphere, so a
 * drone-scale survey (hundreds of metres across) is not cut off by a fixed far
 * plane, and the renderer follows its canvas when the pane resizes.
 * @license GPL-3.0-only
 */

import type { PerspectiveCamera, WebGLRenderer } from "three";

export interface CloudFraming {
  /** Camera distance from the cloud centre that fits the whole cloud. */
  distance: number;
  near: number;
  far: number;
  /** Orbit zoom-out limit that keeps the whole cloud inside the far plane. */
  maxDistance: number;
}

/**
 * Fit the camera to a bounding sphere of `radius`. The far plane covers the
 * cloud from the furthest the orbit controls allow, and the near plane scales
 * with the distance so depth precision holds for both a desk-sized scan and a
 * survey-sized cloud.
 */
export function frameCloud(radius: number): CloudFraming {
  const distance = Math.max(radius * 2.5, 0.5);
  const maxDistance = distance * 10;
  return {
    distance,
    near: Math.max(distance / 1000, 0.01),
    far: maxDistance + radius * 2,
    maxDistance,
  };
}

/**
 * Keep the renderer's drawing buffer and the camera aspect matched to the
 * canvas's laid-out size (pane resize, immersive mode). Returns the disposer.
 */
export function followCanvasSize(
  canvas: HTMLCanvasElement,
  renderer: WebGLRenderer,
  camera: PerspectiveCamera,
): () => void {
  const observer = new ResizeObserver(() => {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  });
  observer.observe(canvas);
  return () => observer.disconnect();
}
