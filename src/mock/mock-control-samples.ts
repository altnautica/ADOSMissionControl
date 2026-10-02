/**
 * Recorded control-output samples for the demo-mode protocol mocks.
 *
 * `sendManualControl` is the fire-and-forget stick output on `DroneProtocol`.
 * It returns void, so a mock that ignores its arguments makes the output path
 * untestable: a caller can pass anything, or nothing, and every assertion
 * still passes. The mocks record the arguments they were handed so a test can
 * pin the real contract instead of the empty one.
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
