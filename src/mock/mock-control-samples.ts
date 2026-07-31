/**
 * Recorded control-output samples for the demo-mode protocol mocks.
 *
 * `sendManualControl`, `sendPositionTarget`, and `sendAttitudeTarget` are the
 * three fire-and-forget control outputs on `DroneProtocol`. They return void,
 * so a mock that ignores its arguments makes the whole output path untestable:
 * a caller can pass anything, or nothing, and every assertion still passes.
 * The mocks record the arguments they were handed so a test can pin the real
 * contract instead of the empty one.
 *
 * @module mock/mock-control-samples
 */

/** One `sendManualControl` call. Roll/pitch/yaw are -1..1; throttle is 0..1. */
export interface ManualControlSample {
  roll: number;
  pitch: number;
  throttle: number;
  yaw: number;
  buttons: number;
}

/** One `sendPositionTarget` call. */
export interface PositionTargetSample {
  lat: number;
  lon: number;
  alt: number;
}

/** One `sendAttitudeTarget` call. Angles in radians, thrust 0..1. */
export interface AttitudeTargetSample {
  roll: number;
  pitch: number;
  yaw: number;
  thrust: number;
}
