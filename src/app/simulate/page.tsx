"use client";

/**
 * @module SimulatePage
 * @description Dedicated simulation page. Reads waypoints from the shared mission store
 * and renders the 3D CesiumJS simulation viewer with playback controls.
 * @license GPL-3.0-only
 */

import { useState, useEffect, useMemo } from "react";
import { useTranslations } from "next-intl";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { ChevronLeft, AlertTriangle, X } from "lucide-react";
import { useMissionStore } from "@/stores/mission-store";
import { usePlannerStore } from "@/stores/planner-store";
import { useSimulationStore } from "@/stores/simulation-store";
import { useGeofenceStore } from "@/stores/geofence-store";
import { useSimulationKeyboard } from "@/hooks/use-simulation-keyboard";
import { validateMission } from "@/lib/validation/mission-validator";
import { SimulateLeftPanel } from "@/components/simulation/SimulateLeftPanel";

const SimulationViewer = dynamic(
  () =>
    import("@/components/simulation/SimulationViewer").then((m) => m.SimulationViewer),
  { ssr: false }
);
const SimulationPanel = dynamic(
  () =>
    import("@/components/simulation/SimulationPanel").then((m) => m.SimulationPanel),
  { ssr: false }
);

export default function SimulatePage() {
  const waypoints = useMissionStore((s) => s.waypoints);
  const defaultSpeed = usePlannerStore((s) => s.defaultSpeed);
  const geofenceEnabled = useGeofenceStore((s) => s.enabled);
  const geofencePolygon = useGeofenceStore((s) => s.polygonPoints);
  const geofenceCircleCenter = useGeofenceStore((s) => s.circleCenter);
  const geofenceCircleRadius = useGeofenceStore((s) => s.circleRadius);
  const geofenceMaxAlt = useGeofenceStore((s) => s.maxAltitude);
  const tSim = useTranslations("simulate");
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const router = useRouter();

  useSimulationKeyboard(true);

  // Validate mission
  const validation = useMemo(() => {
    if (waypoints.length === 0) return null;
    return validateMission(waypoints, {
      geofence: geofenceEnabled
        ? {
            polygonPoints: geofencePolygon.length >= 3 ? geofencePolygon : undefined,
            circleCenter: geofenceCircleCenter ?? undefined,
            circleRadius: geofenceCircleRadius,
            maxAltitude: geofenceMaxAlt,
          }
        : undefined,
    });
  }, [waypoints, geofenceEnabled, geofencePolygon, geofenceCircleCenter, geofenceCircleRadius, geofenceMaxAlt]);

  // Reset banner when waypoints change
  useEffect(() => {
    setBannerDismissed(false);
  }, [waypoints]);

  // Reset simulation state on unmount (navigating away)
  useEffect(() => {
    return () => { useSimulationStore.getState().reset(); };
  }, []);

  return (
    <div className="flex-1 flex h-full overflow-hidden">
      {/* Left panel */}
      <SimulateLeftPanel />

      {/* Validation warning banner */}
      {validation && !bannerDismissed && (validation.errors.length > 0 || validation.warnings.length > 0) && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 max-w-md">
          <div
            className={`flex items-center gap-2 px-4 py-2 rounded-lg border backdrop-blur-md text-xs font-mono ${
              validation.errors.length > 0
                ? "bg-red-500/15 border-red-500/30 text-red-400"
                : "bg-yellow-500/15 border-yellow-500/30 text-yellow-400"
            }`}
          >
            <AlertTriangle size={14} className="shrink-0" />
            <span className="flex-1">
              {validation.errors.length > 0
                ? tSim("missionHasErrors", { count: validation.errors.length })
                : tSim("missionHasWarnings", { count: validation.warnings.length })}
            </span>
            <button
              onClick={() => router.push("/plan")}
              className="text-accent-primary hover:text-accent-primary/80 whitespace-nowrap cursor-pointer"
            >
              {tSim("editPlan")}
            </button>
            <button
              onClick={() => setBannerDismissed(true)}
              className="text-text-tertiary hover:text-text-primary cursor-pointer"
            >
              <X size={12} />
            </button>
          </div>
        </div>
      )}

      {/* 3D Viewer */}
      <SimulationViewer waypoints={waypoints} defaultSpeed={defaultSpeed} />

      {/* Right panel */}
      {!panelCollapsed && (
        <SimulationPanel
          waypoints={waypoints}
          onClose={() => setPanelCollapsed(true)}
        />
      )}

      {/* Collapsed panel toggle */}
      {panelCollapsed && (
        <button
          onClick={() => setPanelCollapsed(false)}
          className="w-8 shrink-0 flex items-center justify-center border-l border-border-default bg-bg-secondary hover:bg-bg-tertiary cursor-pointer"
        >
          <ChevronLeft size={14} className="text-text-tertiary" />
        </button>
      )}
    </div>
  );
}
