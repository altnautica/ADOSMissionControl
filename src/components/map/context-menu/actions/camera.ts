/**
 * @module map/context-menu/actions/camera
 * @description Camera and gimbal action handlers: ROI point/clear, shutter trigger.
 * @license GPL-3.0-only
 */

import type { DroneProtocol } from "@/lib/protocol/types";
import type { MenuPosition, MenuReport } from "../types";

interface CameraArgs {
  protocol: DroneProtocol | null;
  menuPos: MenuPosition;
  relativeAlt: number | undefined;
  report: MenuReport;
}

export async function handlePointCamera({
  protocol,
  menuPos,
  relativeAlt,
  report,
}: CameraArgs): Promise<void> {
  if (!protocol) {
    report("No drone connected", "error");
    return;
  }
  const send = protocol.setRoiLocation ?? protocol.setGimbalROI;
  if (!send) {
    report("This firmware does not support a gimbal ROI", "error");
    return;
  }
  // Ack-tracked: an ROI the vehicle refused used to look identical to one it
  // accepted, because the handler discarded the result.
  const result = await send.call(protocol, menuPos.lat, menuPos.lon, relativeAlt ?? 0);
  report(
    result.success ? "Camera pointed at the selected point" : `Point camera failed: ${result.message}`,
    result.success ? "success" : "error",
  );
}

export async function handleClearRoi(
  protocol: DroneProtocol | null,
  report: MenuReport,
): Promise<void> {
  if (!protocol?.clearRoi) {
    report("This firmware does not support clearing the gimbal ROI", "error");
    return;
  }
  const result = await protocol.clearRoi();
  report(
    result.success ? "Gimbal ROI cleared" : `Clear ROI failed: ${result.message}`,
    result.success ? "success" : "error",
  );
}

export async function handleTriggerCamera(
  protocol: DroneProtocol | null,
  report: MenuReport,
): Promise<void> {
  if (!protocol) {
    report("No drone connected", "error");
    return;
  }
  const result = await protocol.cameraTrigger();
  report(
    result.success ? "Shutter triggered" : `Shutter trigger failed: ${result.message}`,
    result.success ? "success" : "error",
  );
}
