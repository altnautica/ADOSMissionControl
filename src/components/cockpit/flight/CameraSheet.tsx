"use client";

/**
 * @module cockpit/flight/CameraSheet
 * @description Camera settings: the stream switcher (multi-stream nodes), the
 * camera roster and the live video figures (resolution, frame rate, frame age
 * with the estimator that produced it, and the network round trip labelled
 * `net` so it is never read as end-to-end delay). As a sheet it follows the
 * flight screen's sheet rules: rendered at the screen's root beside the right
 * column and below the top bar, closed by Escape, a press outside or its ✕.
 *
 * @license GPL-3.0-only
 */

import { useRef } from "react";
import { X } from "lucide-react";

import { useVideoStore } from "@/stores/video-store";
import { useVideoFrameAge } from "@/hooks/use-video-frame-age";
import { frameAgeLabel } from "@/lib/video/frame-age";
import { specString } from "@/lib/cockpit/spec-strings";
import layoutSpec from "@/lib/cockpit-spec/layout.json";
import { CockpitCameraRoster } from "@/components/vision/CockpitCameraRoster";
import { CockpitStreamTabs } from "../CockpitStreamTabs";
import { useDemoFeedActive } from "../CockpitDemoStream";
import { useFlightGrid } from "./flight-context";
import { FlightSheetPortal, sheetPlacement, useSheetDismiss } from "./flight-sheet";

/** The camera settings trigger, which is not "outside" the sheet. */
export const CAMERA_SHEET_TRIGGER = "[data-sheet-trigger='camera']";

function VideoFigures({ droneId }: { droneId: string }) {
  const demoFeed = useDemoFeedActive(droneId);
  const isStreaming = useVideoStore((s) => s.isStreaming);
  const fps = useVideoStore((s) => s.fps);
  const latencyMs = useVideoStore((s) => s.latencyMs);
  const resolution = useVideoStore((s) => s.resolution);
  const frameAge = useVideoFrameAge();
  if (demoFeed) return <p className="fs-figures">{specString("camera.demo_feed")}</p>;
  if (!isStreaming) return <p className="fs-figures">{specString("camera.no_video")}</p>;
  return (
    <p className="fs-figures" data-testid="fs-video-figures">
      <span>{resolution || "—"}</span>
      <span>
        {fps === null ? "—" : Math.round(fps)} {specString("camera.fps")}
      </span>
      <span data-frame-age-source={frameAge?.source ?? "unknown"}>
        {specString("cockpit.camera.video")} {frameAge ? `+${frameAgeLabel(frameAge)}` : "—"}
      </span>
      <span title={specString("camera.net_title")}>
        {latencyMs === null ? "—" : Math.round(latencyMs)}
        {specString("camera.net")}
      </span>
    </p>
  );
}

/** The camera controls without a frame, for the Menu and the sheet. */
export function CameraPanel({ droneId }: { droneId: string }) {
  return (
    <div className="fs-camera" data-testid="fs-camera-panel">
      <CockpitStreamTabs droneId={droneId} />
      <CockpitCameraRoster />
      <VideoFigures droneId={droneId} />
    </div>
  );
}

export function CameraSheet({ droneId, onClose }: { droneId: string; onClose: () => void }) {
  const grid = useFlightGrid();
  const ref = useRef<HTMLDivElement>(null);
  useSheetDismiss(ref, onClose, CAMERA_SHEET_TRIGGER);
  const title = specString("cockpit.camera.settings");
  const hit = layoutSpec.touch_target.min * grid.scale;
  return (
    <FlightSheetPortal>
      <div
        ref={ref}
        role="dialog"
        aria-label={title}
        className="fs-sheet fs-camera-sheet"
        data-testid="fs-camera-sheet"
        style={{ position: "absolute", ...sheetPlacement(grid, "right") }}
      >
        <header className="fs-sheet-head">
          <h2>{title}</h2>
          <button
            type="button"
            className="fs-sheet-close"
            data-testid="fs-camera-sheet-close"
            aria-label={specString("cockpit.close")}
            title={specString("cockpit.close")}
            style={{ width: hit, height: hit }}
            onClick={onClose}
          >
            <X className="fs-ico-sm" aria-hidden="true" />
          </button>
        </header>
        <CameraPanel droneId={droneId} />
      </div>
    </FlightSheetPortal>
  );
}
