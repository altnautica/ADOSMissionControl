/**
 * @module mavlink-camera-store
 * @description The MAVLink camera each connected drone advertises in its
 * CAMERA_INFORMATION: whether it takes stills and whether it zooms. Keyed by
 * drone id because the camera answers once per connection, so a drone
 * selected later must still have it. An advertisement of neither is not a
 * camera the cockpit can drive and leaves the entry as it was. Cleared when
 * the drone's telemetry bridge is torn down.
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

interface MavlinkCameraState {
  byDrone: Record<string, MavlinkCameraCapabilities>;
  setCamera: (droneId: string, camera: MavlinkCameraCapabilities) => void;
  clear: (droneId: string) => void;
}

export const useMavlinkCameraStore = create<MavlinkCameraState>()((set) => ({
  byDrone: {},
  setCamera: (droneId, camera) =>
    set((s) => {
      if (!camera.capture && !camera.zoom) return s;
      return { byDrone: { ...s.byDrone, [droneId]: { capture: camera.capture, zoom: camera.zoom } } };
    }),
  clear: (droneId) =>
    set((s) => {
      if (!(droneId in s.byDrone)) return s;
      const byDrone = { ...s.byDrone };
      delete byDrone[droneId];
      return { byDrone };
    }),
}));
