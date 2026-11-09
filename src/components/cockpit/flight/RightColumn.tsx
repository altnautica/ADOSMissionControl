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
 * - Gimbal pad: press and hold to tilt or pan the gimbal through the drone
 *   agent's rate route (`POST /api/v1/gimbal/rate`, about 10 Hz, a zero rate
 *   on release). Shown only while `GET` on that route reports the drone takes
 *   rates, and only where the column has room for it.
 * - Camera settings: the stream switcher, the camera roster and the live
 *   video figures.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useTranslations } from "next-intl";
import { Camera, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, SlidersHorizontal, Video, ZoomIn } from "lucide-react";

import { captureScreenshot } from "@/lib/video/webrtc-client";
import { notifySkill } from "@/lib/skills/registry";
import { useFlightRecording } from "@/hooks/use-flight-recording";
import { firePluginSkill } from "@/hooks/use-ds4-dispatcher";
import { RecTimer } from "../RecTimer";
import { CameraSheet } from "./CameraSheet";
import { useFlightGrid } from "./flight-context";
import { rectStyle } from "./flight-grid";
import { useViewZoomStore } from "./view-zoom-store";
import { GimbalRateDriver, gimbalRateAvailable } from "@/lib/cockpit/gimbal-rate";

/** Pad rate at a press (°/s), the controller's full trigger travel. */
const PAD_DPS = 60;
/** How often the pad re-asks whether the drone takes gimbal rates. */
const AVAILABILITY_POLL_MS = 5000;
/** Column height (unscaled px) the stack needs with the pad in it. */
const PAD_COLUMN_MIN_H = 300;

/** Whether the drone's agent takes gimbal rates, re-checked while mounted. */
function useGimbalRateAvailable(droneId: string): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let live = true;
    const check = () =>
      void gimbalRateAvailable(droneId).then((a) => {
        if (live) setAvailable(a);
      });
    check();
    const id = setInterval(check, AVAILABILITY_POLL_MS);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [droneId]);
  return available;
}

const PAD_DIRS = [
  { key: "up", p: 1, y: 0, Icon: ChevronUp, area: "up" },
  { key: "left", p: 0, y: -1, Icon: ChevronLeft, area: "left" },
  { key: "right", p: 0, y: 1, Icon: ChevronRight, area: "right" },
  { key: "down", p: -1, y: 0, Icon: ChevronDown, area: "down" },
] as const;

/** Press-and-hold pitch and yaw buttons driving the gimbal rate. */
export function GimbalPad({ droneId }: { droneId: string }) {
  const t = useTranslations("flightScreen.camera");
  const driver = useRef<GimbalRateDriver | null>(null);
  useEffect(() => {
    const d = new GimbalRateDriver(droneId, PAD_DPS);
    driver.current = d;
    return () => {
      d.stop();
      driver.current = null;
    };
  }, [droneId]);
  const release = () => driver.current?.set(0, 0);
  const press = (p: number, y: number) => driver.current?.set(p * PAD_DPS, y * PAD_DPS);
  return (
    <div className="fs-gimbal-pad" role="group" aria-label={t("gimbal")} data-testid="fs-gimbal-pad">
      {PAD_DIRS.map(({ key, p, y, Icon, area }) => (
        <button
          key={key}
          type="button"
          style={{ gridArea: area }}
          data-testid={`fs-gimbal-${key}`}
          aria-label={t(`gimbalDir.${key}`)}
          title={t(`gimbalDir.${key}`)}
          onPointerDown={(e: ReactPointerEvent<HTMLButtonElement>) => {
            e.currentTarget.setPointerCapture?.(e.pointerId);
            press(p, y);
          }}
          onPointerUp={release}
          onPointerCancel={release}
          onLostPointerCapture={release}
          onKeyDown={(e) => {
            if ((e.key === " " || e.key === "Enter") && !e.repeat) press(p, y);
          }}
          onKeyUp={(e) => {
            if (e.key === " " || e.key === "Enter") release();
          }}
          onBlur={release}
        >
          <Icon className="fs-ico-sm" aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

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
  const gimbal = useGimbalRateAvailable(droneId);
  if (!rect) return null;
  const padFits = rect.h >= PAD_COLUMN_MIN_H * grid.scale;

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
        {gimbal && padFits && <GimbalPad droneId={droneId} />}
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
