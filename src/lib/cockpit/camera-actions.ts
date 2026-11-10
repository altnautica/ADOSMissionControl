/**
 * @module cockpit/camera-actions
 * @description The camera's Photo and Zoom, in one order on every surface
 * (the shutter, the zoom button and the controller):
 *
 * - Photo: a camera extension's own capture, else the vehicle's MAVLink
 *   camera (image capture) when it advertises one, else a grab of the shown
 *   video frame saved as a download. A vehicle camera that refuses the
 *   capture says why (`camera.capture_failed`) and no frame is grabbed in its
 *   place; only a camera that never answered falls back to the frame. With
 *   no video and no camera the result is "No video".
 * - Zoom: a camera extension's zoom, else the vehicle's MAVLink camera zoom
 *   when it advertises one, else the digital zoom of the view (1x / 2x / 4x).
 *   The zoom button steps a vehicle camera in to the end of its travel, then
 *   back out; a refused step says why (`camera.zoom_failed`).
 *
 * The routing is pure over `CameraDeps`; `cockpitPhoto` / `cockpitZoom` run
 * it against the live skill registry, video element and view zoom.
 *
 * @license GPL-3.0-only
 */

import { specText } from "@/lib/hud/spec-text";
import { activate, buildSkillContext, useSkillRegistry } from "@/lib/skills";
import { notifySkill } from "@/lib/skills/registry";
import { captureScreenshot } from "@/lib/video/webrtc-client";
import { ZOOM_STEPS, useViewZoomStore, type ViewZoom } from "@/components/cockpit/flight/view-zoom-store";
import type { CommandResult, DroneProtocol } from "@/lib/protocol/types";
import { useDroneManager } from "@/stores/drone-manager";
import {
  VEHICLE_ZOOM_START,
  useMavlinkCameraStore,
  type MavlinkCameraCapabilities,
} from "@/stores/mavlink-camera-store";

/** Extension skill ids (the part after `plugin:`) for each camera action. */
export const EXTENSION_CAPTURE_IDS = ["capture", "photo", "take-photo"] as const;
export const EXTENSION_ZOOM_IN_IDS = ["zoom-in"] as const;
export const EXTENSION_ZOOM_OUT_IDS = ["zoom-out"] as const;
export const EXTENSION_RECORD_IDS = ["record", "record-toggle"] as const;
export const EXTENSION_RECENTRE_IDS = ["center", "recenter", "gimbal-recenter"] as const;

export type ZoomRoute = "extension" | "mavlink" | "digital";
export type ZoomStep = "cycle" | 1 | -1;
export type ZoomResult = "extension" | "mavlink" | { digital: ViewZoom };
export type PhotoResult = "extension" | "mavlink" | "saved" | "no_video" | { failed: string };

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

/** The toast for a photo result: the spec's "Photo saved" / "No video" /
 *  "Photo failed: {reason}", or null for an extension capture, whose skill
 *  reports its own outcome. */
export function photoResultText(r: PhotoResult): string | null {
  if (typeof r === "object") return specText("camera.capture_failed", { reason: r.failed });
  if (r === "saved" || r === "mavlink") return specText("camera.saved");
  if (r === "no_video") return specText("camera.no_video");
  return null;
}

/** Toast a photo result, alike on every surface (shutter and controller). */
export function announcePhoto(r: PhotoResult): void {
  const text = photoResultText(r);
  if (text) notifySkill(text, r === "saved" || r === "mavlink" ? "success" : "warning");
}

/** A vehicle camera's answer to one command. `answered` is false only when no
 *  COMMAND_ACK came back at all (timeout, no link); a camera that acknowledged
 *  IN_PROGRESS and then went quiet did answer. `reason` is the result's text. */
export interface CameraAnswer {
  ok: boolean;
  answered: boolean;
  reason: string;
}

function noAnswer(e: unknown): CameraAnswer {
  return { ok: false, answered: false, reason: e instanceof Error ? e.message : String(e) };
}

/** A vehicle camera reached over MAVLink, as advertised by its
 *  CAMERA_INFORMATION. */
export interface MavlinkCamera {
  /** The camera advertises zoom control (CAMERA_CAP_FLAGS_HAS_BASIC_ZOOM). */
  zoom: boolean;
  /** MAV_CMD_IMAGE_START_CAPTURE for one image. */
  capture: () => Promise<CameraAnswer>;
  /** MAV_CMD_SET_CAMERA_ZOOM, ZOOM_TYPE_STEP. */
  zoomStep: (by: 1 | -1) => Promise<CameraAnswer>;
}

/**
 * The camera a drone advertised, driven through its protocol: null unless it
 * advertised still capture or zoom and the protocol can send that command.
 * An answer is `ok` only when the advertised command was accepted; a result
 * code of 0 or more is the camera's answer, and so is an acknowledged command
 * with no final result (IN_PROGRESS, then a timeout); -1 unacknowledged is
 * none (timeout, no link).
 */
export function mavlinkCameraFor(
  advertised: MavlinkCameraCapabilities | undefined,
  protocol: Pick<DroneProtocol, "imageStartCapture" | "setCameraZoom"> | undefined,
): MavlinkCamera | null {
  if (!advertised || !protocol) return null;
  const capture = advertised.capture ? protocol.imageStartCapture?.bind(protocol) : undefined;
  const zoomStep = advertised.zoom ? protocol.setCameraZoom?.bind(protocol) : undefined;
  if (!capture && !zoomStep) return null;
  const answer = (r: CommandResult): CameraAnswer => ({
    ok: r.success,
    answered: r.success || r.resultCode >= 0 || r.acknowledged === true,
    reason: r.message,
  });
  const unadvertised = noAnswer(new Error("not advertised"));
  return {
    zoom: zoomStep !== undefined,
    capture: async () => (capture ? answer(await capture()) : unadvertised),
    zoomStep: async (by) => (zoomStep ? answer(await zoomStep(by)) : unadvertised),
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
  /** Where the zoom button has stepped the vehicle camera. */
  vehicleZoom: {
    /** The button's next step. */
    next: (droneId: string) => 1 | -1;
    /** The camera accepted a step. */
    moved: (droneId: string, by: 1 | -1) => void;
  };
  /** The vehicle camera refused a zoom step, or never answered it. */
  zoomFailed: (reason: string) => void;
}

/** Take a photo by the first route that can. */
export async function takePhoto(droneId: string, deps: CameraDeps): Promise<PhotoResult> {
  if (deps.fireExtension(droneId, EXTENSION_CAPTURE_IDS)) return "extension";
  const cam = deps.mavlinkCamera(droneId);
  if (cam) {
    const a = await cam.capture().catch(noAnswer);
    if (a.ok) return "mavlink";
    // A camera that answered with a refusal says why; a frame grab in its
    // place would read as the photo it did not take.
    if (a.answered) return { failed: a.reason };
  }
  return (await deps.grabFrame()) ? "saved" : "no_video";
}

/** Step the zoom by the first route that can. On an extension "cycle" (the
 *  on-screen button) steps in; on a vehicle camera it steps in to the end of
 *  the travel, then back out. */
export function stepZoom(droneId: string, step: ZoomStep, deps: CameraDeps): ZoomResult {
  const ids = step === -1 ? EXTENSION_ZOOM_OUT_IDS : EXTENSION_ZOOM_IN_IDS;
  const cam = deps.mavlinkCamera(droneId);
  const route = zoomRoute({ extensionZoom: deps.extensionOffers(ids), mavlinkCameraZoom: cam?.zoom === true });
  if (route === "extension" && deps.fireExtension(droneId, ids)) return "extension";
  if (route === "mavlink" && cam) {
    const by = step === "cycle" ? deps.vehicleZoom.next(droneId) : step;
    void cam
      .zoomStep(by)
      .catch(noAnswer)
      .then((a) => {
        if (a.ok) deps.vehicleZoom.moved(droneId, by);
        else deps.zoomFailed(a.reason);
      });
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
  vehicleZoom: {
    next: (droneId) => (useMavlinkCameraStore.getState().zoomByDrone[droneId] ?? VEHICLE_ZOOM_START).dir,
    moved: (droneId, by) => useMavlinkCameraStore.getState().zoomMoved(droneId, by),
  },
  zoomFailed: (reason) => notifySkill(specText("camera.zoom_failed", { reason }), "warning"),
};

/** Which zoom the cockpit's zoom button drives for this drone now. */
export function cockpitZoomRoute(droneId: string): ZoomRoute {
  return zoomRoute({
    extensionZoom: LIVE_CAMERA_DEPS.extensionOffers(EXTENSION_ZOOM_IN_IDS),
    mavlinkCameraZoom: LIVE_CAMERA_DEPS.mavlinkCamera(droneId)?.zoom === true,
  });
}

/** The cockpit's Photo (shutter and controller). */
export function cockpitPhoto(droneId: string): Promise<PhotoResult> {
  return takePhoto(droneId, LIVE_CAMERA_DEPS);
}

/** The cockpit's Zoom: the on-screen button cycles, the controller steps. */
export function cockpitZoom(droneId: string, step: ZoomStep): ZoomResult {
  return stepZoom(droneId, step, LIVE_CAMERA_DEPS);
}
