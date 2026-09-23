/**
 * The 3D motor diagram must place motors where they sit on the airframe and
 * tilt the model the way the aircraft tilts. Scene convention: +x right,
 * +y up, -z forward.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { getMotorLayout, type MotorPosition } from "@/lib/motor-layouts";
import {
  BODY_PLANE_ROTATION,
  attitudeToSceneEuler,
  bodyToScene,
  motorScenePosition,
} from "@/components/fc/motors/motor-scene-frame";

function motor(frameClass: number, frameType: number, n: number): MotorPosition {
  const m = getMotorLayout(frameClass, frameType)?.motors.find((x) => x.number === n);
  if (!m) throw new Error(`no motor ${n} in layout ${frameClass}/${frameType}`);
  return m;
}

function side(motorPos: [number, number, number]): string {
  const [x, , z] = motorPos;
  return `${z < 0 ? "front" : z > 0 ? "rear" : "mid"}-${x > 0 ? "right" : x < 0 ? "left" : "centre"}`;
}

function rotated(v: [number, number, number], euler: THREE.Euler): THREE.Vector3 {
  return new THREE.Vector3(...v).applyEuler(euler);
}

describe("motor scene positions", () => {
  it("places Quad X motors at their ArduPilot corners", () => {
    expect(side(motorScenePosition(motor(1, 1, 1), 1, 0))).toBe("front-right");
    expect(side(motorScenePosition(motor(1, 1, 2), 1, 0))).toBe("rear-left");
    expect(side(motorScenePosition(motor(1, 1, 3), 1, 0))).toBe("front-left");
    expect(side(motorScenePosition(motor(1, 1, 4), 1, 0))).toBe("rear-right");
  });

  it("places Quad Plus motor 1 on the right arm and motor 3 on the nose", () => {
    expect(side(motorScenePosition(motor(1, 0, 1), 1, 0))).toBe("mid-right");
    expect(side(motorScenePosition(motor(1, 0, 3), 1, 0))).toBe("front-centre");
  });

  it("scales the position and keeps the vertical offset", () => {
    const [x, y, z] = motorScenePosition(motor(1, 1, 1), 2.5, 0.3);
    expect(x).toBeCloseTo(1.25);
    expect(y).toBeCloseTo(0.3);
    expect(z).toBeCloseTo(-1.25);
  });

  it("lays flat body-plane shapes (x right, y forward) onto the same axes", () => {
    const euler = new THREE.Euler(...BODY_PLANE_ROTATION);
    const nose = rotated([0, 1, 0], euler);
    const expected = bodyToScene(1, 0);
    expect(nose.x).toBeCloseTo(expected[0]);
    expect(nose.y).toBeCloseTo(expected[1]);
    expect(nose.z).toBeCloseTo(expected[2]);
    const rightWing = rotated([1, 0, 0], euler);
    expect(rightWing.x).toBeCloseTo(1);
    expect(rightWing.z).toBeCloseTo(0);
  });
});

describe("attitude to scene orientation", () => {
  const nose = bodyToScene(1, 0);
  const rightWing = bodyToScene(0, 1);

  it("drops the right arm for a positive roll", () => {
    expect(rotated(rightWing, attitudeToSceneEuler(30, 0, 0)).y).toBeLessThan(0);
  });

  it("raises the nose for a positive pitch", () => {
    expect(rotated(nose, attitudeToSceneEuler(0, 20, 0)).y).toBeGreaterThan(0);
  });

  it("turns the nose to the right for a positive yaw", () => {
    const v = rotated(nose, attitudeToSceneEuler(0, 0, 90));
    expect(v.x).toBeCloseTo(1);
    expect(v.z).toBeCloseTo(0);
  });

  it("applies pitch in the yawed frame", () => {
    const v = rotated(nose, attitudeToSceneEuler(0, 10, 90));
    expect(v.x).toBeCloseTo(Math.cos(THREE.MathUtils.degToRad(10)));
    expect(v.y).toBeCloseTo(Math.sin(THREE.MathUtils.degToRad(10)));
    expect(v.z).toBeCloseTo(0);
  });
});

describe("getMotorLayout lookup", () => {
  it("returns no layout for a frame type the table does not have, never the Plus layout", () => {
    // Quad FRAME_TYPE 15 (I) has no bundled layout.
    expect(getMotorLayout(1, 15)).toBeNull();
    expect(getMotorLayout(1, 1)?.typeName).toBe("X");
  });
});
