/**
 * @module map/map-point
 * @description What a picked map point offers, shared by the tile maps and
 * the local-frame map. A right-click (mouse) or a long-press (touch, held
 * `map_long_press_ms` without moving) picks a point. In the air it offers Fly
 * here (the ADOS pilot accepts a goto now, or the FC is in a guided mode); on
 * the ground, with the pilot advertising `goto`, it offers Launch here, which
 * opens the cockpit Launch sheet with the point as its go-to. Points convert
 * between latitude/longitude and local north/east metres about the vehicle's
 * EKF origin.
 *
 * @license GPL-3.0-only
 */

import layoutSpec from "@/lib/cockpit-spec/layout.json";
import type { PilotState } from "@/lib/hud/cockpit-frames";
import { gotoAdvertised, flyHereOffered } from "@/lib/hud/fly-here-offer";
import { CHIP_STALE_AFTER_MS } from "@/lib/hud/flight-state";
import { haversineDistance } from "@/lib/geo/distance";
import { bearing } from "@/lib/telemetry-utils";
import { useDroneManager } from "@/stores/drone-manager";
import { useDroneStore } from "@/stores/drone-store";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import { GUIDED_MODES } from "./map-context-menu-icons";

/** How long a touch is held without moving before it picks a map point. */
export const MAP_LONG_PRESS_MS: number = layoutSpec.map_long_press_ms;

/** A touch that moves further than this (px) is a pan, not a long-press. */
export const LONG_PRESS_SLOP_PX = 10;

/** `[north, east]` metres of `(lat, lon)` from `origin`, the inverse of
 *  `nedToLatLon` (great-circle distance and initial bearing). */
export function latLonToNed(origin: { lat: number; lon: number }, lat: number, lon: number): [number, number] {
  const d = haversineDistance(origin.lat, origin.lon, lat, lon);
  if (d === 0) return [0, 0];
  const b = (bearing(origin.lat, origin.lon, lat, lon) * Math.PI) / 180;
  return [d * Math.cos(b), d * Math.sin(b)];
}

export interface LocalPickView {
  /** Map point at the view centre (metres north / east of the origin). */
  centreNorth: number;
  centreEast: number;
  pxPerM: number;
  /** Canvas size (CSS px); the centre sits at its middle. */
  width: number;
  height: number;
}

/** The local-frame point under canvas pixel `(sx, sy)` of a north-up view:
 *  the inverse of `mapToScreen` in `@/lib/hud/local-frame`. */
export function screenToLocal(view: LocalPickView, sx: number, sy: number): { north: number; east: number } {
  return {
    north: view.centreNorth - (sy - view.height / 2) / view.pxPerM,
    east: view.centreEast + (sx - view.width / 2) / view.pxPerM,
  };
}

/** Whether a picked point offers Launch here: a fresh pilot state that
 *  advertises `goto`, with the drone on the ground (landed or disarmed). */
export function launchHereOffered(p: PilotState | null, pilotAgeMs: number): boolean {
  return p !== null && pilotAgeMs < CHIP_STALE_AFTER_MS && gotoAdvertised(p) && (p.landed || !p.armed);
}

export interface MapPointOffer {
  flyHere: boolean;
  launchHere: boolean;
}

/** What a point picked for `droneId` offers now. The FC guided-mode route
 *  applies only to the selected drone, the one the FC state describes. */
export function mapPointOffer(droneId: string | null, now: number = Date.now()): MapPointOffer {
  if (!droneId) return { flyHere: false, launchHere: false };
  const stamped = useNavStreamStore.getState().byDrone[droneId]?.pilot;
  const pilot = stamped?.data ?? null;
  const age = stamped ? now - stamped.receivedAt : Infinity;
  const fc = useDroneStore.getState();
  const connected =
    fc.connectionState === "connected" || fc.connectionState === "armed" || fc.connectionState === "in_flight";
  const fcGuided =
    useDroneManager.getState().selectedDroneId === droneId &&
    connected &&
    fc.armState === "armed" &&
    GUIDED_MODES.has(fc.flightMode);
  const launchHere = launchHereOffered(pilot, age);
  return { flyHere: !launchHere && (flyHereOffered(pilot, age) || fcGuided), launchHere };
}

/**
 * Call `onPress(clientX, clientY, target)` when a touch or pen pointer is
 * held on `el` for `delayMs` without moving more than
 * {@link LONG_PRESS_SLOP_PX}; a second finger cancels it. Mouse pointers are
 * ignored: a mouse picks a point with a right-click. Returns the detach
 * function.
 */
export function attachLongPress(
  el: HTMLElement,
  onPress: (clientX: number, clientY: number, target: EventTarget | null) => void,
  delayMs: number = MAP_LONG_PRESS_MS,
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let start: { id: number; x: number; y: number } | null = null;

  const cancel = () => {
    clearTimeout(timer);
    timer = undefined;
    start = null;
  };
  const onDown = (e: PointerEvent) => {
    cancel();
    if (e.pointerType === "mouse" || !e.isPrimary) return;
    const s = { id: e.pointerId, x: e.clientX, y: e.clientY };
    const target = e.target;
    start = s;
    timer = setTimeout(() => {
      timer = undefined;
      start = null;
      onPress(s.x, s.y, target);
    }, delayMs);
  };
  const onMove = (e: PointerEvent) => {
    if (!start || e.pointerId !== start.id) return;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > LONG_PRESS_SLOP_PX) cancel();
  };

  el.addEventListener("pointerdown", onDown);
  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerup", cancel);
  el.addEventListener("pointercancel", cancel);
  return () => {
    cancel();
    el.removeEventListener("pointerdown", onDown);
    el.removeEventListener("pointermove", onMove);
    el.removeEventListener("pointerup", cancel);
    el.removeEventListener("pointercancel", cancel);
  };
}

/** Whether a `contextmenu` event came from a touch (the browser's own
 *  long-press), which {@link attachLongPress} handles at the spec duration. */
export function isTouchContextMenu(e: MouseEvent): boolean {
  const pointerType = (e as Partial<PointerEvent>).pointerType;
  if (pointerType) return pointerType === "touch" || pointerType === "pen";
  return (e as MouseEvent & { sourceCapabilities?: { firesTouchEvents?: boolean } }).sourceCapabilities?.firesTouchEvents === true;
}
