/**
 * @module map/context-menu/use-menu-actions
 * @description Action dispatch hook for the right-click flight map menu.
 * Maps menu item ids to the appropriate handler and tells the orchestrator
 * whether to keep the menu open (sub-panel actions) or close it.
 * @license GPL-3.0-only
 */

"use client";

import { useCallback } from "react";
import type { Map as LeafletMap } from "leaflet";
import { useDroneManager, selectSelectedProtocol } from "@/stores/drone-manager";
import { useGuidedStore } from "@/stores/guided-store";
import { handleFlyHere } from "./actions/navigation";
import { landAtPoint, loiterAtPoint } from "@/lib/skills/guided-target";
import { handlePointCamera, handleClearRoi, handleTriggerCamera } from "./actions/camera";
import { handleSetEkfOrigin } from "./actions/home";
import { handleSetHeading } from "./actions/markers";
import { handleCopyCoords, handleMeasureFromDrone } from "./actions/utility";
import type { MenuPosition, MenuReport } from "./types";

interface DroneTelemetry {
  lat: number;
  lon: number;
  relativeAlt?: number;
}

interface UseMenuActionsArgs {
  map: LeafletMap;
  menuPos: MenuPosition | null;
  latestPos: DroneTelemetry | null | undefined;
  distLabel: string;
  bearingToDrone: number;
  openOrbitPanel: () => void;
  openHomeConfirmPanel: () => void;
  openPoiInputPanel: () => void;
  openRallyPanel: () => void;
  /** How a flight-affecting action reports what the vehicle actually did. */
  report: MenuReport;
}

export interface MenuActionResult {
  /** Run the action for `id`. Returns true if the menu should close. */
  dispatch: (id: string) => boolean;
}

export function useMenuActions({
  map,
  menuPos,
  latestPos,
  distLabel,
  bearingToDrone,
  openOrbitPanel,
  openHomeConfirmPanel,
  openPoiInputPanel,
  openRallyPanel,
  report,
}: UseMenuActionsArgs): MenuActionResult {
  const selectedProtocol = useDroneManager(selectSelectedProtocol);
  const selectedDroneId = useDroneManager((s) => s.selectedDroneId);
  const showConfirm = useGuidedStore((s) => s.showConfirm);

  const dispatch = useCallback(
    (id: string): boolean => {
      if (!menuPos) return true;
      const protocol = selectedProtocol;
      const rect = map.getContainer().getBoundingClientRect();
      const relativeAlt = latestPos?.relativeAlt;

      switch (id) {
        case "fly-here":
        case "fly-here-alt": {
          handleFlyHere({
            droneId: selectedDroneId,
            menuPos,
            rectLeft: rect.left,
            rectTop: rect.top,
            showConfirm,
            report,
          });
          return true;
        }
        case "orbit-here": {
          openOrbitPanel();
          return false;
        }
        case "loiter-here": {
          void loiterAtPoint({
            protocol,
            droneId: selectedDroneId,
            lat: menuPos.lat,
            lon: menuPos.lon,
            alt: relativeAlt ?? 10,
            report,
          });
          return true;
        }
        case "land-here": {
          void landAtPoint({
            protocol,
            droneId: selectedDroneId,
            lat: menuPos.lat,
            lon: menuPos.lon,
            alt: relativeAlt ?? 10,
            report,
          });
          return true;
        }
        case "point-camera": {
          void handlePointCamera({ protocol, menuPos, report });
          return true;
        }
        case "clear-roi": {
          void handleClearRoi(protocol, report);
          return true;
        }
        case "trigger-camera": {
          void handleTriggerCamera(protocol, report);
          return true;
        }
        case "set-home": {
          openHomeConfirmPanel();
          return false;
        }
        case "set-ekf-origin": {
          void handleSetEkfOrigin({ protocol, menuPos, report });
          return true;
        }
        case "add-rally": {
          openRallyPanel();
          return false;
        }
        case "add-poi": {
          openPoiInputPanel();
          return false;
        }
        case "set-heading": {
          if (!latestPos) {
            report("Set heading failed: no vehicle position", "error");
            return true;
          }
          void handleSetHeading({
            protocol,
            menuPos,
            fromLat: latestPos.lat,
            fromLon: latestPos.lon,
            report,
          });
          return true;
        }
        case "copy-coords": {
          void handleCopyCoords(menuPos, report);
          return true;
        }
        case "measure-from-drone": {
          void handleMeasureFromDrone({ distLabel, bearingDeg: bearingToDrone, report });
          return true;
        }
      }
      return true;
    },
    [
      menuPos,
      selectedProtocol,
      selectedDroneId,
      map,
      latestPos,
      distLabel,
      bearingToDrone,
      showConfirm,
      openOrbitPanel,
      openHomeConfirmPanel,
      openPoiInputPanel,
      openRallyPanel,
      report,
    ],
  );

  return { dispatch };
}
