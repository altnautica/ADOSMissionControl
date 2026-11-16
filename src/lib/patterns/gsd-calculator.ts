/**
 * @module gsd-calculator
 * @description Ground Sample Distance (GSD) calculator for survey/mapping missions.
 * Computes GSD, image footprint, line spacing (sidelap), and trigger distance (frontlap)
 * given a camera profile, its mounting orientation and the flight altitude.
 * @license GPL-3.0-only
 */

/** Camera sensor and lens profile used for GSD calculations. */
export interface CameraProfile {
  name: string;
  sensorWidth: number;   // mm
  sensorHeight: number;  // mm
  focalLength: number;   // mm
  imageWidth: number;    // pixels
  imageHeight: number;   // pixels
  /** Shortest time between two photos the camera can take, seconds; absent = unknown. */
  minTriggerIntervalS?: number;
}

/**
 * How the camera is mounted. Landscape puts the sensor's long side across the
 * flight line; portrait turns it 90°, so the long side runs along the line.
 */
export type CameraOrientation = "landscape" | "portrait";

/** Built-in camera profiles for common survey/mapping cameras, named by sensor format, resolution and focal length. */
export const CAMERA_PROFILES: CameraProfile[] = [
  { name: "1/2.3-type 21 MP · 2.7 mm", sensorWidth: 6.17, sensorHeight: 4.55, focalLength: 2.7, imageWidth: 5312, imageHeight: 3984 },
  { name: "Full-frame 60 MP · 35 mm", sensorWidth: 35.7, sensorHeight: 23.8, focalLength: 35, imageWidth: 9504, imageHeight: 6336 },
  { name: "4/3-type 21 MP · 12.3 mm", sensorWidth: 17.3, sensorHeight: 13.0, focalLength: 12.29, imageWidth: 5280, imageHeight: 3956 },
  { name: "1/1.3-type 12 MP · 6.7 mm", sensorWidth: 9.7, sensorHeight: 7.3, focalLength: 6.72, imageWidth: 4032, imageHeight: 3024 },
  { name: "APS-C 24 MP · 18.3 mm", sensorWidth: 23.5, sensorHeight: 15.6, focalLength: 18.3, imageWidth: 6000, imageHeight: 4000 },
  { name: 'Generic 1/2.3"', sensorWidth: 6.17, sensorHeight: 4.55, focalLength: 4.5, imageWidth: 4000, imageHeight: 3000 },
];

/** 32-bit FNV-1a hash of a string, as 8 hex digits. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (const ch of s) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * Saved plans store the camera by name. Built-ins were renamed, so a plan saved
 * under a retired built-in name maps to the current one through the FNV-1a hash
 * of that retired name (the retired names themselves are not kept in source).
 */
const RETIRED_NAME_HASHES: Readonly<Record<string, string>> = {
  "4ca8cf51": "1/2.3-type 21 MP · 2.7 mm",
  "3fcc441f": "Full-frame 60 MP · 35 mm",
  "4d8f1e47": "4/3-type 21 MP · 12.3 mm",
  "ec92eea2": "1/1.3-type 12 MP · 6.7 mm",
  "2810edd6": "APS-C 24 MP · 18.3 mm",
};

/**
 * Compute Ground Sample Distance (GSD) in meters per pixel.
 * GSD = (sensorWidth * altitude) / (focalLength * imageWidth)
 *
 * @param altitude    Flight altitude in meters AGL
 * @param focalLength Lens focal length in mm
 * @param sensorWidth Sensor width in mm
 * @param imageWidth  Image width in pixels
 * @returns GSD in meters/pixel
 */
export function computeGSD(
  altitude: number,
  focalLength: number,
  sensorWidth: number,
  imageWidth: number,
): number {
  if (altitude < 0 || sensorWidth <= 0 || focalLength <= 0 || imageWidth <= 0) return 0;
  // sensorWidth is in mm, altitude in m => multiply by 0.001 to get m, then cancel
  // GSD (m/px) = (sensorWidth_mm * altitude_m) / (focalLength_mm * imageWidth_px)
  return (sensorWidth * altitude) / (focalLength * imageWidth);
}

/**
 * Compute image footprint on the ground at a given altitude (or on a wall at a
 * given distance).
 *
 * `width` runs across the flight line and `height` along it. Landscape maps the
 * sensor width across the line; portrait swaps the two axes.
 *
 * @param altitude    Flight altitude in meters AGL (distance to the surface)
 * @param camera      Camera profile
 * @param orientation Camera mounting orientation (default landscape)
 * @returns Footprint width (across-track) and height (along-track) in meters
 */
export function computeFootprint(
  altitude: number,
  camera: CameraProfile,
  orientation: CameraOrientation = "landscape",
): { width: number; height: number } {
  const gsdW = computeGSD(altitude, camera.focalLength, camera.sensorWidth, camera.imageWidth);
  const gsdH = computeGSD(altitude, camera.focalLength, camera.sensorHeight, camera.imageHeight);
  const sensorW = gsdW * camera.imageWidth;
  const sensorH = gsdH * camera.imageHeight;
  return orientation === "portrait"
    ? { width: sensorH, height: sensorW }
    : { width: sensorW, height: sensorH };
}

/**
 * Compute line spacing for a given sidelap percentage.
 * Line spacing = footprint_width * (1 - sidelap)
 *
 * @param altitude    Flight altitude in meters AGL
 * @param camera      Camera profile
 * @param sidelap     Desired sidelap as a fraction (0 to 1), e.g. 0.6 for 60%
 * @param orientation Camera mounting orientation (default landscape)
 * @returns Line spacing in meters
 */
export function computeLineSpacing(
  altitude: number,
  camera: CameraProfile,
  sidelap: number,
  orientation: CameraOrientation = "landscape",
): number {
  const footprint = computeFootprint(altitude, camera, orientation);
  return footprint.width * (1 - sidelap);
}

/**
 * Compute camera trigger distance for a given frontlap percentage.
 * Trigger distance = footprint_height * (1 - frontlap)
 *
 * @param altitude    Flight altitude in meters AGL
 * @param camera      Camera profile
 * @param frontlap    Desired frontlap as a fraction (0 to 1), e.g. 0.7 for 70%
 * @param orientation Camera mounting orientation (default landscape)
 * @returns Trigger distance in meters
 */
export function computeTriggerDistance(
  altitude: number,
  camera: CameraProfile,
  frontlap: number,
  orientation: CameraOrientation = "landscape",
): number {
  const footprint = computeFootprint(altitude, camera, orientation);
  return footprint.height * (1 - frontlap);
}

/**
 * Problems with a camera profile an operator typed in, as stable codes the UI
 * translates. Empty when the profile is usable.
 */
export type CameraProfileProblem = "name" | "sensor" | "image" | "focal" | "interval";

export function validateCameraProfile(camera: CameraProfile): CameraProfileProblem[] {
  const problems: CameraProfileProblem[] = [];
  const positive = (v: number) => Number.isFinite(v) && v > 0;
  if (camera.name.trim() === "") problems.push("name");
  if (!positive(camera.sensorWidth) || !positive(camera.sensorHeight)) problems.push("sensor");
  if (!positive(camera.imageWidth) || !positive(camera.imageHeight)) problems.push("image");
  if (!positive(camera.focalLength)) problems.push("focal");
  if (camera.minTriggerIntervalS !== undefined && !(Number.isFinite(camera.minTriggerIntervalS) && camera.minTriggerIntervalS >= 0)) {
    problems.push("interval");
  }
  return problems;
}

/**
 * Find a camera by name among the built-ins and the operator's custom cameras.
 * A retired built-in name resolves to its renamed built-in.
 */
export function findCamera(
  name: string | undefined,
  custom: readonly CameraProfile[] = [],
): CameraProfile | undefined {
  if (!name) return undefined;
  const exact = CAMERA_PROFILES.find((c) => c.name === name) ?? custom.find((c) => c.name === name);
  if (exact) return exact;
  const renamed = RETIRED_NAME_HASHES[fnv1a(name)];
  return renamed ? CAMERA_PROFILES.find((c) => c.name === renamed) : undefined;
}

/**
 * Fastest speed the camera keeps up with at a trigger distance, m/s, or null
 * when the camera's interval is unknown or the distance is off.
 */
export function maxSpeedForTriggerInterval(camera: CameraProfile, triggerDistanceM: number): number | null {
  const interval = camera.minTriggerIntervalS;
  if (!(interval !== undefined && interval > 0) || !(triggerDistanceM > 0)) return null;
  return triggerDistanceM / interval;
}
