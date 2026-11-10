/**
 * @module mavlink-camera-store
 * @description The MAVLink camera each connected drone advertises in its
 * CAMERA_INFORMATION: whether it takes stills and whether it zooms. Keyed by
 * drone id because the camera answers once per connection, so a drone
 * selected later must still have it. An advertisement of neither is not a
 * camera the cockpit can drive and leaves the entry as it was. Cleared when
 * the drone's telemetry bridge is torn down.
 *
 * It also keeps where the cockpit's zoom button has stepped each vehicle
 * camera to, counted in accepted steps, so the one button can step in to the
 * end of its travel and then back out.
 *
 * @license GPL-3.0-only
 */

import { create } from "zustand";

export interface MavlinkCameraCapabilities {
  /** CAMERA_CAP_FLAGS_CAPTURE_IMAGE */
  capture: boolean;
  /** CAMERA_CAP_FLAGS_HAS_BASIC_ZOOM */
  zoom: boolean;
}

/** Accepted zoom steps the zoom button takes in before it turns back out. */
export const VEHICLE_ZOOM_STEPS = 3;

/** Where the zoom button has stepped a vehicle camera, and which way it goes next. */
export interface VehicleZoomPosition {
  /** Accepted steps in from where the cockpit found it (0..VEHICLE_ZOOM_STEPS). */
  steps: number;
  /** The button's next step: in (1) or out (-1). */
  dir: 1 | -1;
}

export const VEHICLE_ZOOM_START: VehicleZoomPosition = { steps: 0, dir: 1 };

/** The position after one accepted step `by`: held to the travel, turning
 *  back at either end. */
export function nextVehicleZoom(at: VehicleZoomPosition, by: 1 | -1): VehicleZoomPosition {
  const steps = Math.max(0, Math.min(VEHICLE_ZOOM_STEPS, at.steps + by));
  const dir = steps >= VEHICLE_ZOOM_STEPS ? -1 : steps <= 0 ? 1 : at.dir;
  return { steps, dir };
}

interface MavlinkCameraState {
  byDrone: Record<string, MavlinkCameraCapabilities>;
  zoomByDrone: Record<string, VehicleZoomPosition>;
  setCamera: (droneId: string, camera: MavlinkCameraCapabilities) => void;
  /** One zoom step `by` the drone's camera accepted. */
  zoomMoved: (droneId: string, by: 1 | -1) => void;
  clear: (droneId: string) => void;
}

export const useMavlinkCameraStore = create<MavlinkCameraState>()((set) => ({
  byDrone: {},
  zoomByDrone: {},
  setCamera: (droneId, camera) =>
    set((s) => {
      if (!camera.capture && !camera.zoom) return s;
      return { byDrone: { ...s.byDrone, [droneId]: { capture: camera.capture, zoom: camera.zoom } } };
    }),
  zoomMoved: (droneId, by) =>
    set((s) => ({
      zoomByDrone: { ...s.zoomByDrone, [droneId]: nextVehicleZoom(s.zoomByDrone[droneId] ?? VEHICLE_ZOOM_START, by) },
    })),
  clear: (droneId) =>
    set((s) => {
      if (!(droneId in s.byDrone) && !(droneId in s.zoomByDrone)) return s;
      const byDrone = { ...s.byDrone };
      const zoomByDrone = { ...s.zoomByDrone };
      delete byDrone[droneId];
      delete zoomByDrone[droneId];
      return { byDrone, zoomByDrone };
    }),
}));
