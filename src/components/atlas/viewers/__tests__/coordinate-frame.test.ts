import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { COLMAP_TO_YUP_QUAT, orientCloudToYUp } from "../coordinate-frame";

// The COLMAP/OpenCV world frame is Y-down, Z-forward; the viewer is Y-up,
// Z-back. The convention transform is a 180° rotation about X = diag(1,-1,-1):
// X is preserved, Y and Z are negated. Both the splat scene (via the splat library
// orientation quaternion) and the point clouds (via geom.rotateX(π)) must apply
// exactly this, so the two views agree.

describe("COLMAP_TO_YUP_QUAT (splat scene orientation)", () => {
  const q = new THREE.Quaternion().fromArray([...COLMAP_TO_YUP_QUAT]);

  it("is a unit quaternion", () => {
    expect(q.length()).toBeCloseTo(1, 6);
  });

  it("preserves +X (the rotation axis)", () => {
    const v = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    expect(v.x).toBeCloseTo(1, 6);
    expect(v.y).toBeCloseTo(0, 6);
    expect(v.z).toBeCloseTo(0, 6);
  });

  it("negates +Y (up-in-data becomes up-in-viewer)", () => {
    const v = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    expect(v.x).toBeCloseTo(0, 6);
    expect(v.y).toBeCloseTo(-1, 6);
    expect(v.z).toBeCloseTo(0, 6);
  });

  it("negates +Z", () => {
    const v = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    expect(v.z).toBeCloseTo(-1, 6);
  });

  it("is the 180°-about-X rotation (matches geom.rotateX(π))", () => {
    const fromRotateX = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(1, 0, 0),
      Math.PI,
    );
    // angleTo is 0 (or 2π) when the two rotations are the same.
    expect(q.angleTo(fromRotateX)).toBeCloseTo(0, 6);
  });
});

describe("orientCloudToYUp (point-cloud geometry)", () => {
  it("negates Y and Z, preserves X, on the position attribute", () => {
    const geom = new THREE.BufferGeometry();
    // one vertex at (2, 3, 5)
    geom.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array([2, 3, 5]), 3),
    );
    orientCloudToYUp(geom);
    const p = geom.getAttribute("position");
    expect(p.getX(0)).toBeCloseTo(2, 5);
    expect(p.getY(0)).toBeCloseTo(-3, 5);
    expect(p.getZ(0)).toBeCloseTo(-5, 5);
  });

  it("applies the SAME transform as the splat quaternion", () => {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array([1, 2, 3]), 3),
    );
    orientCloudToYUp(geom);
    const p = geom.getAttribute("position");
    const q = new THREE.Quaternion().fromArray([...COLMAP_TO_YUP_QUAT]);
    const expected = new THREE.Vector3(1, 2, 3).applyQuaternion(q);
    expect(p.getX(0)).toBeCloseTo(expected.x, 5);
    expect(p.getY(0)).toBeCloseTo(expected.y, 5);
    expect(p.getZ(0)).toBeCloseTo(expected.z, 5);
  });
});
