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
import { useDroneManager } from "@/stores/drone-manager";
import { useGuidedStore } from "@/stores/guided-store";
import { useRallyStore } from "@/stores/rally-store";
import { handleFlyHere, handleLoiterHere, handleLandHere } from "./actions/navigation";
import { handlePointCamera, handleClearRoi, handleTriggerCamera } from "./actions/camera";
import { handleSetEkfOrigin } from "./actions/home";
import { handleAddRally, handleSetHeading } from "./actions/markers";
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
  report,
}: UseMenuActionsArgs): MenuActionResult {
  const getProtocol = useDroneManager((s) => s.getSelectedProtocol);
  const showConfirm = useGuidedStore((s) => s.showConfirm);
  const addRally = useRallyStore((s) => s.addPoint);
  const uploadRally = useRallyStore((s) => s.uploadRallyPoints);

  const dispatch = useCallback(
    (id: string): boolean => {
      if (!menuPos) return true;
      const protocol = getProtocol();
      const rect = map.getContainer().getBoundingClientRect();
      const relativeAlt = latestPos?.relativeAlt;

      switch (id) {
        case "fly-here":
        case "fly-here-alt": {
          handleFlyHere({
            menuPos,
            rectLeft: rect.left,
            rectTop: rect.top,
            showConfirm,
          });
          return true;
        }
        case "orbit-here": {
          openOrbitPanel();
          return false;
        }
        case "loiter-here": {
          void handleLoiterHere({ protocol, menuPos, relativeAlt, report });
          return true;
        }
        case "land-here": {
          void handleLandHere({ protocol, menuPos, relativeAlt, report });
          return true;
        }
        case "point-camera": {
          void handlePointCamera({ protocol, menuPos, relativeAlt, report });
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
          handleAddRally({ menuPos, relativeAlt, addRally, uploadRally });
          return true;
        }
        case "add-poi": {
          openPoiInputPanel();
          return false;
        }
        case "set-heading": {
          if (latestPos) {
            handleSetHeading({
              protocol,
              menuPos,
              fromLat: latestPos.lat,
              fromLon: latestPos.lon,
            });
          }
          return true;
        }
        case "copy-coords": {
          handleCopyCoords(menuPos);
          return true;
        }
        case "measure-from-drone": {
          handleMeasureFromDrone({ distLabel, bearingDeg: bearingToDrone });
          return true;
        }
      }
      return true;
    },
    [
      menuPos,
      getProtocol,
      map,
      latestPos,
      distLabel,
      bearingToDrone,
      showConfirm,
      addRally,
      uploadRally,
      openOrbitPanel,
      openHomeConfirmPanel,
      openPoiInputPanel,
      report,
    ],
  );

  return { dispatch };
}
