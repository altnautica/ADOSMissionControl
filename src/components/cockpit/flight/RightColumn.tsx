"use client";

/**
 * @module cockpit/flight/RightColumn
 * @description The right column (cockpit spec `layout.json` `right_column`),
 * vertically centred: the 56 px shutter, the photo / video switch, the zoom
 * step and the camera settings.
 *
 * What each control really does on this ground station:
 * - Photo: saves a still of the received picture (PNG download).
 * - Video: starts and stops the flight recording (the received video plus
 *   the telemetry log), the same recorder as everywhere else in the app.
 * - Zoom: a digital zoom of the view, 1x / 2x / 4x; the data layers scale
 *   with the picture so boxes stay on their targets.
 * - Camera settings: the stream switcher, the camera roster and the live
 *   video figures.
 *
 * The gimbal pad is not drawn: no gimbal rate route exists to drive, and the
 * column never shows a control that does nothing.
 *
 * @license GPL-3.0-only
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Camera, SlidersHorizontal, Video, ZoomIn } from "lucide-react";

import { captureScreenshot } from "@/lib/video/webrtc-client";
import { notifySkill } from "@/lib/skills/registry";
import { useFlightRecording } from "@/hooks/use-flight-recording";
import { firePluginSkill } from "@/hooks/use-ds4-dispatcher";
import { RecTimer } from "../RecTimer";
import { CameraSheet } from "./CameraSheet";
import { useFlightGrid } from "./flight-context";
import { rectStyle } from "./flight-grid";
import { useViewZoomStore } from "./view-zoom-store";

type CaptureMode = "photo" | "video";

export function RightColumn({ droneId }: { droneId: string }) {
  const t = useTranslations("flightScreen.camera");
  const grid = useFlightGrid();
  const rect = grid.zones.right_column;
  const [mode, setMode] = useState<CaptureMode>("photo");
  const [sheetOpen, setSheetOpen] = useState(false);
  const { isRecording, toggle } = useFlightRecording(droneId);
  const zoom = useViewZoomStore((s) => s.byDrone[droneId] ?? 1);
  const cycleZoom = useViewZoomStore((s) => s.cycle);
  if (!rect) return null;

  // A camera extension's own capture / record skill wins (the same order as
  // the controller's Photo and Record buttons); without one, the ground
  // station captures the received picture itself.
  const shoot = () => {
    if (mode === "video") {
      if (!firePluginSkill(droneId, ["record", "record-toggle"])) toggle();
      return;
    }
    if (firePluginSkill(droneId, ["capture", "photo", "take-photo"])) return;
    void captureScreenshot().then((blob) => {
      if (!blob) notifySkill(t("noPicture"), "warning");
    });
  };

  return (
    <div className="fs-col fs-col-right" data-zone="right_column" style={rectStyle(rect)}>
      <div className="fs-col-stack">
        <button
          type="button"
          className="fs-shutter"
          data-testid="fs-shutter"
          data-mode={mode}
          data-recording={isRecording ? "true" : "false"}
          style={{ width: grid.target, height: grid.target }}
          aria-label={mode === "photo" ? t("takePhoto") : isRecording ? t("stopVideo") : t("startVideo")}
          title={mode === "photo" ? t("takePhoto") : isRecording ? t("stopVideo") : t("startVideo")}
          onClick={shoot}
        >
          <i aria-hidden="true" />
        </button>
        {isRecording && (
          <span className="fs-rec" data-testid="fs-rec-timer">
            <RecTimer droneId={droneId} />
          </span>
        )}
        <div className="fs-mode" role="group" aria-label={t("mode")}>
          <button
            type="button"
            aria-pressed={mode === "photo"}
            aria-label={t("photo")}
            title={t("photo")}
            disabled={isRecording}
            onClick={() => setMode("photo")}
          >
            <Camera className="fs-ico-sm" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-pressed={mode === "video"}
            aria-label={t("video")}
            title={t("video")}
            onClick={() => setMode("video")}
          >
            <Video className="fs-ico-sm" aria-hidden="true" />
          </button>
        </div>
        <button
          type="button"
          className="fs-btn fs-col-btn"
          data-testid="fs-zoom"
          aria-label={t("zoom", { z: zoom })}
          title={t("zoom", { z: zoom })}
          onClick={() => cycleZoom(droneId)}
        >
          {zoom === 1 ? <ZoomIn className="fs-ico-sm" aria-hidden="true" /> : null}
          <span>{zoom}×</span>
        </button>
        <button
          type="button"
          className="fs-btn fs-col-btn"
          data-testid="fs-camera-settings"
          aria-haspopup="dialog"
          aria-expanded={sheetOpen}
          aria-label={t("settings")}
          title={t("settings")}
          onClick={() => setSheetOpen((o) => !o)}
        >
          <SlidersHorizontal className="fs-ico-sm" aria-hidden="true" />
        </button>
      </div>
      {sheetOpen && <CameraSheet droneId={droneId} onClose={() => setSheetOpen(false)} />}
    </div>
  );
}
