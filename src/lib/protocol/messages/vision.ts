/**
 * Vision-source MAVLink message decoders.
 *
 * Covers the messages a CV / VIO pipeline typically injects into the
 * autopilot or emits for downstream consumers: optical flow (scalar
 * and angular-rate forms), full 6DoF odometry, and pre-fused vision
 * position estimates.
 *
 * Wire field order follows the MAVLink generator's "largest type first"
 * packing rule — note that several of these messages declare integer
 * fields before float fields in the XML, but the wire packs floats
 * first because their type size is larger. The offsets below reflect
 * the wire order, not the declaration order.
 *
 * @module protocol/messages/vision
 */

// ── OPTICAL_FLOW (ID 100) ───────────────────────────────────

export interface OpticalFlowData {
  timeUsec: bigint;
  sensorId: number;
  /** Raw flow integer (dpi). */
  flowX: number;
  flowY: number;
  /** Flow in metres-per-second (computed from sensor + altitude). */
  flowCompMX: number;
  flowCompMY: number;
  /** Quality 0..255 (0=unusable, 255=excellent). */
  quality: number;
  /** Ground distance in metres (positive for distance below sensor). */
  groundDistance: number;
  /** Angular-rate flow (rad/s) — v2 extension, undefined if payload too short. */
  flowRateX?: number;
  flowRateY?: number;
}

/**
 * Decode OPTICAL_FLOW (msg ID 100).
 *
 * Wire order (uint64 → float32 → int16 → uint8 → float32 ext):
 * | Offset | Type    | Field           |
 * |--------|---------|-----------------|
 * | 0      | uint64  | timeUsec        |
 * | 8      | float32 | flowCompMX      |
 * | 12     | float32 | flowCompMY      |
 * | 16     | float32 | groundDistance  |
 * | 20     | int16   | flowX           |
 * | 22     | int16   | flowY           |
 * | 24     | uint8   | sensorId        |
 * | 25     | uint8   | quality         |
 * | 26     | float32 | flowRateX (ext) |
 * | 30     | float32 | flowRateY (ext) |
 */
export function decodeOpticalFlow(view: DataView): OpticalFlowData {
  const hasExtensions = view.byteLength >= 34;
  return {
    timeUsec: view.getBigUint64(0, true),
    flowCompMX: view.getFloat32(8, true),
    flowCompMY: view.getFloat32(12, true),
    groundDistance: view.getFloat32(16, true),
    flowX: view.getInt16(20, true),
    flowY: view.getInt16(22, true),
    sensorId: view.getUint8(24),
    quality: view.getUint8(25),
    flowRateX: hasExtensions ? view.getFloat32(26, true) : undefined,
    flowRateY: hasExtensions ? view.getFloat32(30, true) : undefined,
  };
}

// ── OPTICAL_FLOW_RAD (ID 106) ───────────────────────────────

export interface OpticalFlowRadData {
  timeUsec: bigint;
  sensorId: number;
  /** Integration window length in microseconds. */
  integrationTimeUs: number;
  /** Flow integrated over `integrationTimeUs` (rad). */
  integratedX: number;
  integratedY: number;
  /** Gyro integrated over `integrationTimeUs` (rad). */
  integratedXgyro: number;
  integratedYgyro: number;
  integratedZgyro: number;
  /** Temperature (centi-degC). */
  temperature: number;
  /** Quality 0..255 (0=unusable, 255=excellent). */
  quality: number;
  /** Time since last distance reading (microseconds). */
  timeDeltaDistanceUs: number;
  /** Distance to ground / surface (metres). */
  distance: number;
}

/**
 * Decode OPTICAL_FLOW_RAD (msg ID 106).
 *
 * Wire order (uint64 → uint32 → float32 → int16 → uint8):
 * | Offset | Type    | Field               |
 * |--------|---------|---------------------|
 * | 0      | uint64  | timeUsec            |
 * | 8      | uint32  | integrationTimeUs   |
 * | 12     | float32 | integratedX         |
 * | 16     | float32 | integratedY         |
 * | 20     | float32 | integratedXgyro     |
 * | 24     | float32 | integratedYgyro     |
 * | 28     | float32 | integratedZgyro     |
 * | 32     | uint32  | timeDeltaDistanceUs |
 * | 36     | float32 | distance            |
 * | 40     | int16   | temperature         |
 * | 42     | uint8   | sensorId            |
 * | 43     | uint8   | quality             |
 */
export function decodeOpticalFlowRad(view: DataView): OpticalFlowRadData {
  return {
    timeUsec: view.getBigUint64(0, true),
    integrationTimeUs: view.getUint32(8, true),
    integratedX: view.getFloat32(12, true),
    integratedY: view.getFloat32(16, true),
    integratedXgyro: view.getFloat32(20, true),
    integratedYgyro: view.getFloat32(24, true),
    integratedZgyro: view.getFloat32(28, true),
    timeDeltaDistanceUs: view.getUint32(32, true),
    distance: view.getFloat32(36, true),
    temperature: view.getInt16(40, true),
    sensorId: view.getUint8(42),
    quality: view.getUint8(43),
  };
}

// ── ODOMETRY (ID 331) ────────────────────────────────────────

export interface OdometryData {
  timeUsec: bigint;
  /** MAV_FRAME of the pose. */
  frameId: number;
  /** MAV_FRAME of the velocity / body twist. */
  childFrameId: number;
  /** Position in `frameId` (metres). */
  x: number;
  y: number;
  z: number;
  /** Attitude quaternion in [w, x, y, z] order. */
  q: [number, number, number, number];
  /** Linear velocity in `childFrameId` (m/s). */
  vx: number;
  vy: number;
  vz: number;
  /** Angular velocity in `childFrameId` (rad/s). */
  rollspeed: number;
  pitchspeed: number;
  yawspeed: number;
  /** Upper-triangular row-major 6x6 pose covariance (21 elements). NaN[0] = unknown. */
  poseCovariance: number[];
  /** Upper-triangular row-major 6x6 velocity covariance (21 elements). NaN[0] = unknown. */
  velocityCovariance: number[];
  resetCounter: number;
  /** MAV_ESTIMATOR_TYPE enum. */
  estimatorType: number;
  /**
   * Odometry quality, as MAVLink defines it for ODOMETRY:
   *   `-1` = odometry has FAILED, `0` = unknown / unset, `1..100` = quality.
   *
   * It is a SIGNED byte. Reading it unsigned turned the `-1` failure sentinel
   * into 255, i.e. an off-scale "better than perfect" reading for an estimator
   * that had just reported it was not working.
   *
   * `undefined` means the field carried the unknown value (0), so a consumer
   * falls back to deriving quality from the covariance instead of treating an
   * unset field as a measured zero.
   */
  quality?: number;
}

/**
 * Decode ODOMETRY (msg ID 331).
 *
 * Wire order (uint64 → float32 → float32[4] → floats → float32[21]x2 → uint8 → ext uint8):
 * | Offset | Type        | Field              |
 * |--------|-------------|--------------------|
 * | 0      | uint64      | timeUsec           |
 * | 8      | float32     | x                  |
 * | 12     | float32     | y                  |
 * | 16     | float32     | z                  |
 * | 20     | float32[4]  | q (w, x, y, z)     |
 * | 36     | float32     | vx                 |
 * | 40     | float32     | vy                 |
 * | 44     | float32     | vz                 |
 * | 48     | float32     | rollspeed          |
 * | 52     | float32     | pitchspeed         |
 * | 56     | float32     | yawspeed           |
 * | 60     | float32[21] | poseCovariance     |
 * | 144    | float32[21] | velocityCovariance |
 * | 228    | uint8       | frameId            |
 * | 229    | uint8       | childFrameId       |
 * | 230    | uint8       | resetCounter (ext) |
 * | 231    | uint8       | estimatorType (ext)|
 * | 232    | int8        | quality (ext)      |
 */
export function decodeOdometry(view: DataView): OdometryData {
  const poseCovariance = readCovariance(view, 60);
  const velocityCovariance = readCovariance(view, 144);
  // The parser zero-restores a truncated payload up to PAYLOAD_LENGTHS[331],
  // which is 233 — so a `byteLength >= 233` test can never be false and the
  // "extension absent" branch was dead, along with the covariance fallback
  // behind it. MAVLink encodes "unknown / unset quality" as 0, which is the
  // same value a zero-restored absent extension yields, so 0 IS the honest
  // absent signal and the only one available.
  const rawQuality = view.getInt8(232);
  return {
    timeUsec: view.getBigUint64(0, true),
    x: view.getFloat32(8, true),
    y: view.getFloat32(12, true),
    z: view.getFloat32(16, true),
    q: [
      view.getFloat32(20, true),
      view.getFloat32(24, true),
      view.getFloat32(28, true),
      view.getFloat32(32, true),
    ],
    vx: view.getFloat32(36, true),
    vy: view.getFloat32(40, true),
    vz: view.getFloat32(44, true),
    rollspeed: view.getFloat32(48, true),
    pitchspeed: view.getFloat32(52, true),
    yawspeed: view.getFloat32(56, true),
    poseCovariance,
    velocityCovariance,
    frameId: view.getUint8(228),
    childFrameId: view.getUint8(229),
    resetCounter: view.getUint8(230),
    estimatorType: view.getUint8(231),
    quality: rawQuality === 0 ? undefined : rawQuality,
  };
}

// ── VISION_POSITION_ESTIMATE (ID 102) ───────────────────────

export interface VisionPositionEstimateData {
  usec: bigint;
  /** Local position (metres) in the estimator's local frame. */
  x: number;
  y: number;
  z: number;
  /** Attitude (radians). */
  roll: number;
  pitch: number;
  yaw: number;
  /** Upper-triangular row-major 6x6 covariance (21 elements). Empty if extension absent. */
  covariance: number[];
  /** Estimate reset counter — increments when the upstream estimator resets. */
  resetCounter: number;
}

/**
 * Decode VISION_POSITION_ESTIMATE (msg ID 102).
 *
 * Wire order (uint64 → float32 → float32[21] ext → uint8 ext):
 * | Offset | Type        | Field              |
 * |--------|-------------|--------------------|
 * | 0      | uint64      | usec               |
 * | 8      | float32     | x                  |
 * | 12     | float32     | y                  |
 * | 16     | float32     | z                  |
 * | 20     | float32     | roll               |
 * | 24     | float32     | pitch              |
 * | 28     | float32     | yaw                |
 * | 32     | float32[21] | covariance (ext)   |
 * | 116    | uint8       | resetCounter (ext) |
 */
export function decodeVisionPositionEstimate(view: DataView): VisionPositionEstimateData {
  const hasCovariance = view.byteLength >= 116;
  const hasResetCounter = view.byteLength >= 117;
  return {
    usec: view.getBigUint64(0, true),
    x: view.getFloat32(8, true),
    y: view.getFloat32(12, true),
    z: view.getFloat32(16, true),
    roll: view.getFloat32(20, true),
    pitch: view.getFloat32(24, true),
    yaw: view.getFloat32(28, true),
    covariance: hasCovariance ? readCovariance(view, 32) : [],
    resetCounter: hasResetCounter ? view.getUint8(116) : 0,
  };
}

// ── VISION_POSITION_DELTA (ID 11011, ArduPilot dialect) ─────

export interface VisionPositionDeltaData {
  timeUsec: bigint;
  /** Elapsed wall time of the delta window (microseconds). */
  timeDeltaUsec: bigint;
  /** Rotation vector [roll, pitch, yaw] in body-FRD (radians). */
  angleDelta: [number, number, number];
  /** Translation [x, y, z] in body-FRD (metres). */
  positionDelta: [number, number, number];
  /** Confidence 0..100 (%). */
  confidence: number;
}

/**
 * Decode VISION_POSITION_DELTA (msg ID 11011).
 *
 * Wire order (uint64 → uint64 → float32[3] → float32[3] → float32):
 * | Offset | Type       | Field         |
 * |--------|------------|---------------|
 * | 0      | uint64     | timeUsec      |
 * | 8      | uint64     | timeDeltaUsec |
 * | 16     | float32[3] | angleDelta    |
 * | 28     | float32[3] | positionDelta |
 * | 40     | float32    | confidence    |
 */
export function decodeVisionPositionDelta(view: DataView): VisionPositionDeltaData {
  return {
    timeUsec: view.getBigUint64(0, true),
    timeDeltaUsec: view.getBigUint64(8, true),
    angleDelta: [
      view.getFloat32(16, true),
      view.getFloat32(20, true),
      view.getFloat32(24, true),
    ],
    positionDelta: [
      view.getFloat32(28, true),
      view.getFloat32(32, true),
      view.getFloat32(36, true),
    ],
    confidence: view.getFloat32(40, true),
  };
}

// ── helpers ──────────────────────────────────────────────────

/**
 * Read a length-21 upper-triangular row-major 6x6 covariance matrix.
 *
 * The MAVLink convention is that if the first element is NaN the whole
 * matrix is unknown. Preserve that signal — do not zero-fill.
 */
function readCovariance(view: DataView, offset: number): number[] {
  const out = new Array<number>(21);
  for (let i = 0; i < 21; i++) {
    out[i] = view.getFloat32(offset + i * 4, true);
  }
  return out;
}
