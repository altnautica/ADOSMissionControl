/**
 * @module mock/mock-ekf-source
 * @description The demo FC's active EKF3 source set and the
 * EKF_STATUS_REPORT flags it implies. The demo parameter sets are
 * 1 = external nav, 2 = optical flow, 3 = GPS. `setEkfSourceSet` on the mock
 * protocol writes here; the telemetry tick and the demo `nav.state` read it.
 * @license GPL-3.0-only
 */

/** EKF_STATUS_REPORT flag bits. */
const ATTITUDE = 1;
const VEL_H = 2;
const VEL_V = 4;
const POS_H_REL = 8;
const POS_H_ABS = 16;
const POS_V_ABS = 32;
const POS_V_AGL = 64;
const PRED_POS_H_REL = 256;

const HEALTHY = ATTITUDE | VEL_H | VEL_V | POS_H_REL | POS_H_ABS | POS_V_ABS | POS_V_AGL | PRED_POS_H_REL;

let activeSet: 1 | 2 | 3 = 1;

export function getMockEkfSourceSet(): 1 | 2 | 3 {
  return activeSet;
}

export function setMockEkfSourceSet(set: 1 | 2 | 3): void {
  activeSet = set;
}

/** Flags for a healthy estimator on `set`: optical flow carries no absolute
 * horizontal position, so set 2 drops POS_H_ABS. */
export function mockEkfFlags(set: 1 | 2 | 3 = activeSet): number {
  return set === 2 ? HEALTHY & ~POS_H_ABS : HEALTHY;
}
