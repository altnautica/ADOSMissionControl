/**
 * @module cockpit/camera-actions
 * @description The camera's Photo and Zoom, in one order on every surface
 * (the shutter, the zoom button and the controller):
 *
 * - Photo: a camera extension's own capture, else the vehicle's MAVLink
 *   camera (image capture) when it advertises one, else a grab of the shown
 *   video frame saved as a download. Never refused for want of a camera;
 *   with no video and no camera the result is "No video".
 * - Zoom: a camera extension's zoom, else the vehicle's MAVLink camera zoom
 *   when it advertises one, else the digital zoom of the view (1x / 2x / 4x).
 *
 * The routing is pure over `CameraDeps`; `cockpitPhoto` / `cockpitZoom` run
 * it against the live skill registry, video element and view zoom.
 *
 * @license GPL-3.0-only
 */

import { specText } from "@/lib/hud/spec-text";
import { activate, buildSkillContext, useSkillRegistry } from "@/lib/skills";
import { captureScreenshot } from "@/lib/video/webrtc-client";
import { ZOOM_STEPS, useViewZoomStore, type ViewZoom } from "@/components/cockpit/flight/view-zoom-store";
import type { DroneProtocol } from "@/lib/protocol/types";
import { useDroneManager } from "@/stores/drone-manager";
import { useMavlinkCameraStore, type MavlinkCameraCapabilities } from "@/stores/mavlink-camera-store";

/** Extension skill ids (the part after `plugin:`) for each camera action. */
export const EXTENSION_CAPTURE_IDS = ["capture", "photo", "take-photo"] as const;
export const EXTENSION_ZOOM_IN_IDS = ["zoom-in"] as const;
export const EXTENSION_ZOOM_OUT_IDS = ["zoom-out"] as const;

export type ZoomRoute = "extension" | "mavlink" | "digital";
export type ZoomStep = "cycle" | 1 | -1;
export type ZoomResult = "extension" | "mavlink" | { digital: ViewZoom };
export type PhotoResult = "extension" | "mavlink" | "saved" | "no_video";

/** Which zoom a step drives: the extension's, else the vehicle camera's, else digital. */
export function zoomRoute(c: { extensionZoom: boolean; mavlinkCameraZoom: boolean }): ZoomRoute {
  if (c.extensionZoom) return "extension";
  if (c.mavlinkCameraZoom) return "mavlink";
  return "digital";
}

/** The digital zoom step at or below `n` (1, 2 or 4). */
export function digitalZoomStep(n: number): ViewZoom {
  let step: ViewZoom = ZOOM_STEPS[0];
  for (const s of ZOOM_STEPS) if (n >= s) step = s;
  return step;
}

/** The digital zoom's label (`camera.digital_zoom`), e.g. "Digital ×2". */
export function digitalZoomLabel(n: number): string {
  return specText("camera.digital_zoom", { n: digitalZoomStep(n) });
}

/** The toast for a photo result: the spec's "Photo saved" / "No video", or
 *  null for an extension capture, whose skill reports its own outcome. */
export function photoResultText(r: PhotoResult): string | null {
  if (r === "saved" || r === "mavlink") return specText("camera.saved");
  if (r === "no_video") return specText("camera.no_video");
  return null;
}

/** A vehicle camera reached over MAVLink, as advertised by its
 *  CAMERA_INFORMATION. */
export interface MavlinkCamera {
  /** The camera advertises zoom control (CAMERA_CAP_FLAGS_HAS_BASIC_ZOOM). */
  zoom: boolean;
  /** MAV_CMD_IMAGE_START_CAPTURE for one image; resolves true when accepted. */
  capture: () => Promise<boolean>;
  /** MAV_CMD_SET_CAMERA_ZOOM, ZOOM_TYPE_STEP; resolves true when accepted. */
  zoomStep: (by: 1 | -1) => Promise<boolean>;
}

/**
 * The camera a drone advertised, driven through its protocol: null unless it
 * advertised still capture or zoom and the protocol can send that command.
 * Each action resolves true only when the advertised command was accepted.
 */
export function mavlinkCameraFor(
  advertised: MavlinkCameraCapabilities | undefined,
  protocol: Pick<DroneProtocol, "imageStartCapture" | "setCameraZoom"> | undefined,
): MavlinkCamera | null {
  if (!advertised || !protocol) return null;
  const capture = advertised.capture ? protocol.imageStartCapture?.bind(protocol) : undefined;
  const zoomStep = advertised.zoom ? protocol.setCameraZoom?.bind(protocol) : undefined;
  if (!capture && !zoomStep) return null;
  return {
    zoom: zoomStep !== undefined,
    capture: async () => (capture ? (await capture()).success : false),
    zoomStep: async (by) => (zoomStep ? (await zoomStep(by)).success : false),
  };
}

export interface CameraDeps {
  /** Whether a camera extension offers one of these skills. */
  extensionOffers: (ids: readonly string[]) => boolean;
  /** Fire the first offered skill of `ids`; false when none is offered. */
  fireExtension: (droneId: string, ids: readonly string[]) => boolean;
  /** The vehicle's advertised MAVLink camera, or null. */
  mavlinkCamera: (droneId: string) => MavlinkCamera | null;
  /** Grab the shown video frame and save it as a download; null with no picture. */
  grabFrame: () => Promise<Blob | null>;
  digitalZoom: {
    get: (droneId: string) => ViewZoom;
    cycle: (droneId: string) => void;
    step: (droneId: string, by: 1 | -1) => void;
  };
}

/** Take a photo by the first route that can. */
export async function takePhoto(droneId: string, deps: CameraDeps): Promise<PhotoResult> {
  if (deps.fireExtension(droneId, EXTENSION_CAPTURE_IDS)) return "extension";
  const cam = deps.mavlinkCamera(droneId);
  if (cam) {
    // A refused or unanswered capture falls through to the shown frame.
    const ok = await cam.capture().catch(() => false);
    if (ok) return "mavlink";
  }
  return (await deps.grabFrame()) ? "saved" : "no_video";
}

/** Step the zoom by the first route that can. On an extension or a vehicle
 *  camera, "cycle" (the on-screen button) steps in. */
export function stepZoom(droneId: string, step: ZoomStep, deps: CameraDeps): ZoomResult {
  const ids = step === -1 ? EXTENSION_ZOOM_OUT_IDS : EXTENSION_ZOOM_IN_IDS;
  const cam = deps.mavlinkCamera(droneId);
  const route = zoomRoute({ extensionZoom: deps.extensionOffers(ids), mavlinkCameraZoom: cam?.zoom === true });
  if (route === "extension" && deps.fireExtension(droneId, ids)) return "extension";
  if (route === "mavlink" && cam) {
    void cam.zoomStep(step === -1 ? -1 : 1).catch(() => false);
    return "mavlink";
  }
  if (step === "cycle") deps.digitalZoom.cycle(droneId);
  else deps.digitalZoom.step(droneId, step);
  return { digital: deps.digitalZoom.get(droneId) };
}

/** The first plugin skill whose local id is in `ids`. */
function pluginSkillId(ids: readonly string[]): string | null {
  for (const s of useSkillRegistry.getState().skills.values()) {
    if (s.source !== "plugin") continue;
    if (ids.includes(s.id.slice(s.id.indexOf(":") + 1))) return s.id;
  }
  return null;
}

/** The live dependencies. The vehicle camera is the one the drone advertised
 *  in CAMERA_INFORMATION, driven through its connected protocol. */
export const LIVE_CAMERA_DEPS: CameraDeps = {
  extensionOffers: (ids) => pluginSkillId(ids) !== null,
  fireExtension: (droneId, ids) => {
    const id = pluginSkillId(ids);
    if (!id) return false;
    void activate(id, buildSkillContext(droneId));
    return true;
  },
  mavlinkCamera: (droneId) =>
    mavlinkCameraFor(
      useMavlinkCameraStore.getState().byDrone[droneId],
      useDroneManager.getState().drones.get(droneId)?.protocol,
    ),
  grabFrame: captureScreenshot,
  digitalZoom: {
    get: (droneId) => useViewZoomStore.getState().byDrone[droneId] ?? 1,
    cycle: (droneId) => useViewZoomStore.getState().cycle(droneId),
    step: (droneId, by) => useViewZoomStore.getState().step(droneId, by),
  },
};

/** The cockpit's Photo (shutter and controller). */
export function cockpitPhoto(droneId: string): Promise<PhotoResult> {
  return takePhoto(droneId, LIVE_CAMERA_DEPS);
}

/** The cockpit's Zoom: the on-screen button cycles, the controller steps. */
export function cockpitZoom(droneId: string, step: ZoomStep): ZoomResult {
  return stepZoom(droneId, step, LIVE_CAMERA_DEPS);
}
