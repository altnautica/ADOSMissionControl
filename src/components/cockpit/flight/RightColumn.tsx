"use client";

/**
 * @module cockpit/flight/RightColumn
 * @description The right column (cockpit spec `layout.json` `right_column`),
 * vertically centred: the 56 px shutter, the photo / video switch, the zoom
 * step, the gimbal pad and the camera settings, in the spec's item order.
 *
 * What each control really does on this ground station:
 * - Photo: a camera extension's capture, else the vehicle camera, else a
 *   still of the received picture (PNG download). A vehicle camera that
 *   refuses says why.
 * - Video: starts and stops the flight recording (the received video plus
 *   the telemetry log), the same recorder as everywhere else in the app.
 * - Zoom: a camera extension's zoom, else the vehicle camera (one step in to
 *   the end of its travel, then back out, the label naming the next step),
 *   else a digital zoom of the view, 1x / 2x / 4x; the data layers scale
 *   with the picture so boxes stay on their targets.
 * - Gimbal pad: drag to aim the camera through the drone agent's rate route
 *   (`POST /api/v1/gimbal/rate`). Shown only while `GET` on that route
 *   reports the drone takes rates.
 * - Camera settings: the stream switcher, the camera roster and the live
 *   video figures, in a sheet.
 *
 * When the column is too short for every item, items leave it in the spec's
 * `drop_order`.
 *
 * @license GPL-3.0-only
 */

import { Fragment, useCallback, useState } from "react";
import { Camera, SlidersHorizontal, Video, ZoomIn, ZoomOut } from "lucide-react";

import {
  EXTENSION_RECORD_IDS,
  announcePhoto,
  cockpitPhoto,
  cockpitZoom,
  cockpitZoomRoute,
  digitalZoomLabel,
} from "@/lib/cockpit/camera-actions";
import { useSkillRegistry } from "@/lib/skills";
import { useDroneManager } from "@/stores/drone-manager";
import { VEHICLE_ZOOM_START, useMavlinkCameraStore } from "@/stores/mavlink-camera-store";
import { specString } from "@/lib/cockpit/spec-strings";
import layoutSpec from "@/lib/cockpit-spec/layout.json";
import { useFlightRecording } from "@/hooks/use-flight-recording";
import { firePluginSkill } from "@/hooks/use-ds4-dispatcher";
import { RecTimer } from "../RecTimer";
import { CameraSheet } from "./CameraSheet";
import { useFlightGrid } from "./flight-context";
import { rectStyle } from "./flight-grid";
import { useFlightSheet } from "./flight-sheet";
import { GIMBAL_PAD_PX, GimbalPad, useGimbalRateAvailable } from "./GimbalPad";
import { useViewZoomStore } from "./view-zoom-store";

export type RightItem = "shutter" | "photo_video_switch" | "zoom" | "gimbal_pad" | "camera_settings";

const ZONE = layoutSpec.zones.find((z) => z.id === "right_column") as unknown as {
  items: RightItem[];
  drop_order: RightItem[];
};
/** The column's items, top to bottom (spec order). */
export const RIGHT_ITEMS: readonly RightItem[] = ZONE.items;
/** The order items leave a column too short for all of them (spec). */
export const RIGHT_DROP_ORDER: readonly RightItem[] = ZONE.drop_order;

const HIT = layoutSpec.touch_target.min;
/** The switch: two hit-size buttons, a 2 px gap and 2 px padding. */
const SWITCH_H = 2 * HIT + 2 + 4;
/** The recording timer under the shutter while recording. */
const REC_TIMER_H = 16;
/** The stack's gap and padding (chrome gap token, `.fs-col-stack`). */
const STACK_GAP = 8;
const STACK_PAD = 6;

/** Each item's height in the column, unscaled. */
const ITEM_H: Record<RightItem, number> = {
  shutter: layoutSpec.touch_target.shutter,
  photo_video_switch: SWITCH_H,
  zoom: HIT,
  gimbal_pad: GIMBAL_PAD_PX,
  camera_settings: HIT,
};

function stackHeight(items: readonly RightItem[], recording: boolean): number {
  const body = items.reduce((h, it) => h + ITEM_H[it], 0) + STACK_GAP * Math.max(0, items.length - 1);
  return body + 2 * STACK_PAD + (recording ? REC_TIMER_H + STACK_GAP : 0);
}

/**
 * The items a column of height `h` shows: the spec's items (less the gimbal
 * pad when the drone takes no gimbal rates), dropping items in the spec's
 * `drop_order` until the stack fits.
 */
export function rightColumnItems(h: number, scale: number, opts: { gimbal: boolean; recording?: boolean }): RightItem[] {
  let items = RIGHT_ITEMS.filter((it) => it !== "gimbal_pad" || opts.gimbal);
  for (const drop of RIGHT_DROP_ORDER) {
    if (stackHeight(items, opts.recording ?? false) * scale <= h) break;
    items = items.filter((it) => it !== drop);
  }
  return items;
}

type CaptureMode = "photo" | "video";

export function RightColumn({ droneId }: { droneId: string }) {
  const grid = useFlightGrid();
  const rect = grid.zones.right_column;
  const [mode, setMode] = useState<CaptureMode>("photo");
  const [sheetOpen, setSheetOpen] = useFlightSheet("camera");
  const closeSheet = useCallback(() => setSheetOpen(false), [setSheetOpen]);
  const { isRecording, toggle } = useFlightRecording(droneId);
  const zoom = useViewZoomStore((s) => s.byDrone[droneId] ?? 1);
  // The zoom route turns on the skills, the advertised camera and the link.
  useSkillRegistry((s) => s.skills);
  useMavlinkCameraStore((s) => s.byDrone[droneId]);
  useDroneManager((s) => s.drones.get(droneId)?.protocol);
  const vehicleZoom = useMavlinkCameraStore((s) => s.zoomByDrone[droneId] ?? VEHICLE_ZOOM_START);
  const gimbal = useGimbalRateAvailable(droneId);
  if (!rect) return null;
  const items = rightColumnItems(rect.h, grid.scale, { gimbal, recording: isRecording });
  const hit = HIT * grid.scale;

  // A camera extension's own capture / record skill wins (the same order as
  // the controller's Photo and Record buttons); then the vehicle camera; then
  // the ground station captures the received picture itself.
  const shoot = () => {
    if (mode === "video") {
      if (!firePluginSkill(droneId, EXTENSION_RECORD_IDS)) toggle();
      return;
    }
    void cockpitPhoto(droneId).then(announcePhoto);
  };

  const shutterLabel =
    mode === "photo"
      ? specString("cockpit.camera.take_photo")
      : isRecording
        ? specString("cockpit.camera.stop_recording")
        : specString("cockpit.camera.start_recording");
  const zoomRoute = cockpitZoomRoute(droneId);
  const zoomLabel =
    zoomRoute === "mavlink"
      ? specString(vehicleZoom.dir === 1 ? "cockpit.zoom.in" : "cockpit.zoom.out")
      : zoomRoute === "extension"
        ? specString("cockpit.zoom")
        : digitalZoomLabel(zoom);

  const render = (item: RightItem) => {
    switch (item) {
      case "shutter":
        return (
          <Fragment key={item}>
            <button
              type="button"
              className="fs-shutter"
              data-item={item}
              data-testid="fs-shutter"
              data-mode={mode}
              data-recording={isRecording ? "true" : "false"}
              style={{ width: grid.target, height: grid.target }}
              aria-label={shutterLabel}
              title={shutterLabel}
              onClick={shoot}
            >
              <i aria-hidden="true" />
            </button>
            {isRecording && (
              <span className="fs-rec" data-testid="fs-rec-timer">
                <RecTimer droneId={droneId} />
              </span>
            )}
          </Fragment>
        );
      case "photo_video_switch":
        return (
          <div
            key={item}
            className="fs-mode"
            role="group"
            data-item={item}
            data-testid="fs-photo_video_switch"
            aria-label={specString("cockpit.camera.shutter_mode")}
          >
            <button
              type="button"
              aria-pressed={mode === "photo"}
              aria-label={specString("cockpit.camera.photo")}
              title={specString("cockpit.camera.photo")}
              style={{ width: hit, height: hit }}
              disabled={isRecording}
              onClick={() => setMode("photo")}
            >
              <Camera className="fs-ico-sm" aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-pressed={mode === "video"}
              aria-label={specString("cockpit.camera.video")}
              title={specString("cockpit.camera.video")}
              style={{ width: hit, height: hit }}
              onClick={() => setMode("video")}
            >
              <Video className="fs-ico-sm" aria-hidden="true" />
            </button>
          </div>
        );
      case "zoom":
        return (
          <button
            key={item}
            type="button"
            className="fs-btn fs-col-btn"
            data-item={item}
            data-testid="fs-zoom"
            style={{ width: hit, height: hit }}
            aria-label={zoomLabel}
            title={zoomLabel}
            onClick={() => cockpitZoom(droneId, "cycle")}
          >
            {zoomRoute === "mavlink" && vehicleZoom.dir === -1 ? (
              <ZoomOut className="fs-ico-sm" aria-hidden="true" />
            ) : zoomRoute !== "digital" || zoom === 1 ? (
              <ZoomIn className="fs-ico-sm" aria-hidden="true" />
            ) : null}
            {zoomRoute === "digital" ? <span aria-hidden="true">{zoom}×</span> : null}
          </button>
        );
      case "gimbal_pad":
        return <GimbalPad key={item} droneId={droneId} scale={grid.scale} />;
      case "camera_settings":
        return (
          <button
            key={item}
            type="button"
            className="fs-btn fs-col-btn"
            data-item={item}
            data-testid="fs-camera_settings"
            data-sheet-trigger="camera"
            style={{ width: hit, height: hit }}
            aria-haspopup="dialog"
            aria-expanded={sheetOpen}
            aria-label={specString("cockpit.camera.settings")}
            title={specString("cockpit.camera.settings")}
            onClick={() => setSheetOpen((o) => !o)}
          >
            <SlidersHorizontal className="fs-ico-sm" aria-hidden="true" />
          </button>
        );
    }
  };

  return (
    <div className="fs-col fs-col-right" data-zone="right_column" data-items={items.join(" ")} style={rectStyle(rect)}>
      <div className="fs-col-stack">{items.map(render)}</div>
      {sheetOpen && <CameraSheet droneId={droneId} onClose={closeSheet} />}
    </div>
  );
}
