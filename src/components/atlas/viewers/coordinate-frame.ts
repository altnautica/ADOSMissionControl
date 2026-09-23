/**
 * @module atlas/viewers/coordinate-frame
 * @description The single place the Atlas viewers correct a reconstruction's
 * world frame. Reconstructions come out of the COLMAP / OpenCV pipeline, whose
 * world frame is Y-DOWN, Z-FORWARD — the SfM keeps COLMAP's world basis, and
 * only the *camera* basis is flipped to OpenGL upstream, so the world points
 * stay Y-down. three.js and the splat viewer library render Y-UP, Z-BACK, so a
 * raw reconstruction loads upside-down. The convention transform is a 180°
 * rotation about X — negate Y and Z, `diag(1, -1, -1)` — the same transform the
 * compute node already applies to camera extrinsics. Applied once here and shared
 * by every three-based viewer so the Splat and point-cloud views agree.
 * @license GPL-3.0-only
 */

import type { BufferGeometry } from "three";

/**
 * The splat library's `addSplatScene` scene-orientation quaternion `[x, y, z, w]` for a
 * 180° rotation about X (axis (1,0,0), angle π → `[1, 0, 0, 0]`). The library reads
 * `options.rotation || options.orientation` and applies it to the whole splat
 * scene (positions + covariance), so this lifts a Brush `.ply` from the COLMAP
 * Y-down frame into the viewer's Y-up frame.
 */
export const COLMAP_TO_YUP_QUAT: readonly [number, number, number, number] = [
  1, 0, 0, 0,
];

/**
 * Rotate a parsed point-cloud geometry in place from the COLMAP Y-down frame into
 * the viewer's Y-up frame (180° about X). Call BEFORE `computeBoundingSphere` so
 * the framing sphere is computed on the corrected coordinates.
 */
export function orientCloudToYUp(geom: BufferGeometry): void {
  geom.rotateX(Math.PI);
}
