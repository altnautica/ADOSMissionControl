/**
 * @module mock/mock-protocol-camera
 * @description The demo vehicle's MAVLink camera. It answers the camera
 * request with a CAMERA_INFORMATION advertising still capture and basic zoom
 * from the camera component, and acks MAV_CMD_IMAGE_START_CAPTURE and
 * MAV_CMD_SET_CAMERA_ZOOM, so the cockpit's Photo and Zoom take the vehicle
 * camera route in demo mode.
 * @license GPL-3.0-only
 */

import type { CameraInformationCallback, CommandResult } from "@/lib/protocol/types";
import { CAMERA_CAP_FLAGS_CAPTURE_IMAGE, CAMERA_CAP_FLAGS_HAS_BASIC_ZOOM } from "@/lib/protocol/messages";

export const MAV_CMD_IMAGE_START_CAPTURE = 2000;
export const MAV_CMD_SET_CAMERA_ZOOM = 531;

/** MAV_COMP_ID_CAMERA: the component the demo camera answers from. */
const CAMERA_COMP_ID = 100;

const ACCEPTED: CommandResult = { success: true, resultCode: 0, message: "Accepted" };

export class MockCamera {
  private cbs: CameraInformationCallback[] = [];
  private images = 0;
  private zoomSteps = 0;

  /** `advertised`: whether this vehicle speaks the MAVLink camera protocol. */
  constructor(private readonly advertised: () => boolean) {}

  /** Subscribe to CAMERA_INFORMATION; the camera answers at once, as on a
   * request when the connection comes up. */
  onCameraInformation(cb: CameraInformationCallback): () => void {
    this.cbs.push(cb);
    if (this.advertised()) {
      const flags = CAMERA_CAP_FLAGS_CAPTURE_IMAGE | CAMERA_CAP_FLAGS_HAS_BASIC_ZOOM;
      cb({ timestamp: Date.now(), compId: CAMERA_COMP_ID, flags, cameraDeviceId: 0, capture: true, zoom: true });
    }
    return () => {
      this.cbs = this.cbs.filter((c) => c !== cb);
    };
  }

  /** One still image (MAV_CMD_IMAGE_START_CAPTURE). */
  async imageStartCapture(): Promise<CommandResult> {
    if (!this.advertised()) return { success: false, resultCode: 3, message: "No camera" };
    this.images += 1;
    return { ...ACCEPTED, message: `Image ${this.images} captured` };
  }

  /** One zoom step (MAV_CMD_SET_CAMERA_ZOOM, continuous). */
  async setCameraZoom(step: 1 | -1): Promise<CommandResult> {
    if (!this.advertised()) return { success: false, resultCode: 3, message: "No camera" };
    this.zoomSteps += step;
    return { ...ACCEPTED, message: `Zoom step ${this.zoomSteps}` };
  }

  /** MAV_CMD_SET_CAMERA_ZOOM as ArduPilot answers it: continuous (1) and
   *  range (2) zoom only, ZOOM_TYPE_STEP denied; a zero rate stops. */
  private zoomCommand(params: readonly number[]): Promise<CommandResult> {
    const [type = 0, value = 0] = params;
    if (type !== 1 && type !== 2) return Promise.resolve({ success: false, resultCode: 2, message: "Zoom type denied" });
    if (!this.advertised()) return Promise.resolve({ success: false, resultCode: 3, message: "No camera" });
    if (type === 1 && value === 0) return Promise.resolve({ ...ACCEPTED, message: "Zoom stopped" });
    return this.setCameraZoom(value < 0 ? -1 : 1);
  }

  /** The ack for a COMMAND_LONG this camera handles, or null for another command. */
  ackCommand(commandId: number, params: readonly number[]): Promise<CommandResult> | null {
    if (commandId === MAV_CMD_IMAGE_START_CAPTURE) return this.imageStartCapture();
    if (commandId === MAV_CMD_SET_CAMERA_ZOOM) return this.zoomCommand(params);
    return null;
  }
}
