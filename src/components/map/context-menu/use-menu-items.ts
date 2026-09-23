/**
 * @module map/context-menu/use-menu-items
 * @description Computes the context-aware list of menu items for the current
 * connection state, arm state, flight mode, and vehicle type.
 * @license GPL-3.0-only
 */

"use client";

import { useMemo } from "react";
import { useDroneStore } from "@/stores/drone-store";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useDroneManager } from "@/stores/drone-manager";
import { GUIDED_MODES } from "../map-context-menu-icons";
import type { MenuItemDef } from "./types";

export interface MenuContext {
  isConnected: boolean;
  isArmed: boolean;
  canNavigate: boolean;
  isCopter: boolean;
  flightMode: string;
  /** The selected FC accepts a rally-point upload. */
  canRally: boolean;
}

export function useMenuContext(): MenuContext {
  const connectionState = useDroneStore((s) => s.connectionState);
  const flightMode = useDroneStore((s) => s.flightMode);
  const armState = useDroneStore((s) => s.armState);
  const frameType = useDroneStore((s) => s.frameType);
  const canRally = useDroneManager((s) => !!s.getSelectedProtocol()?.uploadRallyPoints);

  const isConnected =
    connectionState === "connected" ||
    connectionState === "armed" ||
    connectionState === "in_flight";
  const isArmed = armState === "armed";
  const canNavigate = isConnected && isArmed && GUIDED_MODES.has(flightMode);
  const isCopter = frameType === "copter" || frameType === "heli";

  return { isConnected, isArmed, canNavigate, isCopter, flightMode, canRally };
}

export function useMenuItems(ctx: MenuContext): MenuItemDef[] {
  const posBuffer = useTelemetryStore((s) => s.position);
  const latestPos = posBuffer.latest();
  const hasDronePos = !!(latestPos && latestPos.lat !== 0);

  const { canNavigate, isConnected, isArmed, isCopter, flightMode, canRally } = ctx;

  return useMemo<MenuItemDef[]>(() => {
    const items: MenuItemDef[] = [];

    // Group 0: Navigation
    if (canNavigate) {
      items.push({ id: "fly-here", label: "Fly Here", icon: "flyHere", group: 0, shortcut: "G" });
      items.push({ id: "fly-here-alt", label: "Fly Here at Alt...", icon: "flyHereAlt", group: 0 });
    }
    if (canNavigate && isCopter) {
      items.push({ id: "orbit-here", label: "Orbit Here...", icon: "orbit", group: 0, shortcut: "O" });
    }
    if (canNavigate) {
      items.push({ id: "loiter-here", label: "Loiter Here", icon: "loiter", group: 0 });
      items.push({ id: "land-here", label: "Land Here", icon: "land", group: 0 });
    }

    // Group 1: Camera/Gimbal
    if (isConnected) {
      items.push({ id: "point-camera", label: "Point Camera Here", icon: "roi", group: 1 });
      items.push({ id: "clear-roi", label: "Clear Camera ROI", icon: "clearRoi", group: 1 });
      items.push({ id: "trigger-camera", label: "Trigger Camera", icon: "camera", group: 1 });
    }

    // Group 2: Home/Origin
    if (isConnected) {
      items.push({ id: "set-home", label: "Set Home Here", icon: "home", group: 2 });
      items.push({ id: "set-ekf-origin", label: "Set EKF Origin", icon: "ekf", group: 2 });
    }

    // Group 3: Markers
    if (isConnected && canRally) {
      items.push({ id: "add-rally", label: "Add Rally Point", icon: "rally", group: 3 });
    }
    items.push({ id: "add-poi", label: "Add POI Marker", icon: "poi", group: 3 });
    if (isConnected && isArmed && GUIDED_MODES.has(flightMode)) {
      items.push({ id: "set-heading", label: "Set Heading Toward", icon: "heading", group: 3 });
    }

    // Group 4: Utility
    items.push({ id: "copy-coords", label: "Copy Coordinates", icon: "copy", group: 4 });
    if (isConnected && hasDronePos) {
      items.push({ id: "measure-from-drone", label: "Measure from Drone", icon: "measure", group: 4 });
    }

    return items;
  }, [canNavigate, isConnected, isArmed, isCopter, flightMode, canRally, hasDronePos]);
}
