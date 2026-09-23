/**
 * @module PlannerRightPanel
 * @description Right side panel for the mission planner page containing all collapsible sections.
 * @license GPL-3.0-only
 */
"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronRight, Plus } from "lucide-react";
import { useValidationOptions } from "@/hooks/use-validation-options";
import { validateMission } from "@/lib/validation/mission-validator";
import { MissionEditor } from "@/components/planner/MissionEditor";
import { WaypointList } from "@/components/planner/WaypointList";
import { acceptRadiusDefault } from "@/components/planner/waypoint-constants";
import { GeofenceEditor } from "@/components/planner/GeofenceEditor";
import { DefaultsSection } from "@/components/planner/DefaultsSection";
import { RallyPointEditor } from "@/components/planner/RallyPointEditor";
import { PoiEditor } from "@/components/planner/PoiEditor";
import { usePlanPoiStore } from "@/stores/plan-poi-store";
import { ValidationPanel } from "@/components/planner/ValidationPanel";
import { TerrainProfileChart } from "@/components/planner/TerrainProfileChart";
import { TransformPanel } from "@/components/planner/TransformPanel";
import { PatternEditor } from "@/components/planner/PatternEditor";
import { PlannerCopilot } from "@/components/planner/PlannerCopilot";
import { TemplatesPanel } from "@/components/planner/TemplatesPanel";
import { BatchEditor } from "@/components/planner/BatchEditor";
import { MissionActions } from "@/components/planner/MissionActions";
import { SunTimesCard } from "@/components/planner/SunTimesCard";
import { PreflightChecklist } from "@/components/planner/PreflightChecklist";
import { EnergyCard } from "@/components/planner/EnergyCard";
import { WeatherCard } from "@/components/planner/WeatherCard";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { useToast } from "@/components/ui/toast";
import { useDrawingStore } from "@/stores/drawing-store";
import { importBoundaryFile } from "@/lib/mission-io";
import { ShapefileNotGeographicError } from "@/lib/formats/shp-import";
import { exportFlightBrief } from "@/lib/pdf/export-flight-brief";
import { polygonArea } from "@/lib/drawing/geo-utils";
import { buildMissionFile, makeShareLink, buildShareUrl } from "@/lib/plan-share";
import { capturePlanExtras } from "@/lib/plan-workspace";
import { PanelBand } from "@/components/ui/panel-group";
import { usePlannerStore } from "@/stores/planner-store";
import { useGeofenceStore } from "@/stores/geofence-store";
import { useMissionStore } from "@/stores/mission-store";
import { randomId } from "@/lib/utils";
import type { Waypoint } from "@/lib/types";
import type { usePlanner } from "./use-planner";

interface PlannerRightPanelProps {
  p: ReturnType<typeof usePlanner>;
  showGeofence: boolean;
  showRally: boolean;
  hasDrone: boolean;
  patternOpen: boolean;
  validationOpen: boolean;
  terrainOpen: boolean;
  togglePattern: () => void;
  toggleValidation: () => void;
  toggleTerrain: () => void;
}

export function PlannerRightPanel({
  p, showGeofence, showRally, hasDrone,
  patternOpen, validationOpen, terrainOpen,
  togglePattern, toggleValidation, toggleTerrain,
}: PlannerRightPanelProps) {
  const t = useTranslations("planner");
  const tGeo = useTranslations("geofence");
  const tRally = useTranslations("rally");
  const tPoi = useTranslations("poi");
  const tTerrain = useTranslations("terrain");
  const tTransform = useTranslations("transform");
  const tValidation = useTranslations("validation");
  const selectedWaypointIds = usePlannerStore((s) => s.selectedWaypointIds);
  const clearMultiSelection = usePlannerStore((s) => s.clearMultiSelection);
  const geofenceEnabled = useGeofenceStore((s) => s.enabled);
  const poiCount = usePlanPoiStore((s) => s.points.length);

  // Block upload while the mission has hard errors (out-of-fence, below terrain,
  // bad jump target, etc.) so an invalid mission can't be pushed to the FC.
  const validationOptions = useValidationOptions();
  const uploadErrorCount = useMemo(
    () => (p.waypoints.length > 0 ? validateMission(p.waypoints, validationOptions).errors.length : 0),
    [p.waypoints, validationOptions],
  );

  // Insert a waypoint between waypoint index-1 and index. Position is the midpoint
  // of its two neighbours, altitude their average, and it inherits the preceding
  // waypoint's frame + speed. When inserting past the last row (no following
  // waypoint) the new point is nudged off the previous one.
  const handleInsertAt = useCallback((index: number) => {
    const wps = useMissionStore.getState().waypoints;
    const before = wps[index - 1];
    if (!before) return;
    const after = wps[index];
    const newWp: Waypoint = {
      id: randomId(),
      lat: after ? (before.lat + after.lat) / 2 : before.lat + 0.0005,
      lon: after ? (before.lon + after.lon) / 2 : before.lon + 0.0005,
      alt: after ? (before.alt + after.alt) / 2 : before.alt,
      speed: before.speed,
      frame: before.frame,
      command: "WAYPOINT",
      ...acceptRadiusDefault("WAYPOINT", usePlannerStore.getState().defaultAcceptRadius),
    };
    useMissionStore.getState().insertWaypoint(newWp, index);
  }, []);

  const activePlanName = p.activePlanId ? p.missionName || t("untitledMission") : null;

  // Flight-brief PDF export: real computed stats from the current plan.
  const { toast } = useToast();
  const droneName = p.drones.find((d) => d.id === p.selectedDroneId)?.name;
  const handleExportBrief = useCallback(() => {
    void exportFlightBrief({
      waypoints: p.waypoints,
      name: p.missionName || t("untitledMission"),
      droneName,
      defaultSpeed: p.defaultSpeed,
      defaultFrame: p.defaultFrame,
    });
  }, [p.waypoints, p.missionName, droneName, p.defaultSpeed, p.defaultFrame, t]);

  // Boundary import (KML/KMZ/shapefile): push each real parsed ring into the
  // drawing store as a survey boundary. A file with no polygon warns, never fakes.
  const boundaryInputRef = useRef<HTMLInputElement | null>(null);
  const handleImportBoundary = useCallback(() => boundaryInputRef.current?.click(), []);

  // Client-only share link: encode the whole plan into the URL fragment + copy it.
  // Nothing is uploaded; too-large plans fall back to file export with an honest note.
  const handleCopyShareLink = useCallback(async () => {
    const now = Date.now();
    const file = buildMissionFile(
      p.waypoints,
      { name: p.missionName || t("untitledMission"), createdAt: now, updatedAt: now },
      capturePlanExtras(),
    );
    const link = makeShareLink(file);
    if (link.tooLarge || !link.encoded) {
      toast(t("share.tooLarge"), "warning");
      return;
    }
    try {
      const url = buildShareUrl(window.location.origin, window.location.pathname, link.encoded);
      await navigator.clipboard.writeText(url);
      toast(t("share.copied"), "success");
    } catch {
      toast(t("share.copyFailed"), "error");
    }
  }, [p.waypoints, p.missionName, t, toast]);
  const handleBoundaryFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const rings = await importBoundaryFile(file);
      if (rings.length === 0) {
        toast(t("import.boundary.noPolygon"), "warning");
        return;
      }
      const add = useDrawingStore.getState().addPolygon;
      for (const vertices of rings) {
        add({ id: randomId(), vertices, area: polygonArea(vertices) });
      }
      toast(t("import.boundary.success", { count: rings.length }), "success");
    } catch (err) {
      if (err instanceof ShapefileNotGeographicError) {
        toast(t("import.boundary.needsPrj"), "warning");
        return;
      }
      toast(t("import.boundary.error"), "error");
    }
  }, [t, toast]);

  return (
    <div className="w-[320px] shrink-0 flex flex-col border-l border-border-default bg-bg-secondary">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-default">
        <div className="flex items-center gap-1.5 min-w-0">
          {p.isDirty && <span className="w-1.5 h-1.5 rounded-full bg-status-warning shrink-0" title={t("unsavedChanges")} />}
          <h2 className="text-sm font-display font-semibold text-text-primary truncate">{activePlanName || t("missionPlanner")}</h2>
        </div>
        <button onClick={p.togglePanel} className="text-text-tertiary hover:text-text-primary cursor-pointer"><ChevronRight size={14} /></button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <PanelBand title={t("bands.setup")}>
          <CollapsibleSection title={t("missionSetup")} defaultOpen={true}>
            <MissionEditor drones={p.drones} missionName={p.missionName} selectedDroneId={p.selectedDroneId}
              onNameChange={p.setMissionName} onDroneChange={p.setSelectedDroneId} />
          </CollapsibleSection>
          <CollapsibleSection title={t("defaults")}>
            <DefaultsSection defaultAlt={p.defaultAlt} defaultSpeed={p.defaultSpeed} defaultAcceptRadius={p.defaultAcceptRadius} defaultFrame={p.defaultFrame}
              onAltChange={(v) => p.setDefaults({ defaultAlt: v })} onSpeedChange={(v) => p.setDefaults({ defaultSpeed: v })}
              onRadiusChange={(v) => p.setDefaults({ defaultAcceptRadius: v })} onFrameChange={(v) => p.setDefaults({ defaultFrame: v })} />
          </CollapsibleSection>
        </PanelBand>
        <PanelBand title={t("bands.build")}>
          <CollapsibleSection title={t("copilot.title")} defaultOpen={true}>
            <PlannerCopilot />
          </CollapsibleSection>
          <CollapsibleSection title={t("flightPatterns")} open={patternOpen} onToggle={togglePattern}>
            <PatternEditor onApply={p.handlePatternApply} />
          </CollapsibleSection>
          <CollapsibleSection title={t("templates.title")}>
            <TemplatesPanel />
          </CollapsibleSection>
          <CollapsibleSection title={t("waypoints")} defaultOpen={true} count={p.waypoints.length}
            trailing={<button onClick={p.handleAddManualWaypoint} className="text-text-tertiary hover:text-accent-primary cursor-pointer"><Plus size={14} /></button>}>
            <WaypointList waypoints={p.waypoints} selectedId={p.selectedWaypointId} expandedId={p.expandedWaypointId}
              onSelect={p.handleWaypointClick} onExpand={p.setExpandedWaypoint} onUpdate={p.updateWaypoint}
              onRemove={p.removeWaypoint} onReorder={p.reorderWaypoints} onInsertAt={handleInsertAt} />
          </CollapsibleSection>
          {selectedWaypointIds.length >= 2 && (
            <CollapsibleSection title={t("batchEdit")} defaultOpen={true}>
              <BatchEditor selectedIds={selectedWaypointIds} onClearSelection={clearMultiSelection} />
            </CollapsibleSection>
          )}
          {showGeofence && (
            <CollapsibleSection title={tGeo("title")} trailing={<span className="text-[10px] font-mono text-text-tertiary">{geofenceEnabled ? t("on") : t("off")}</span>}>
              <GeofenceEditor onDrawOnMap={(fenceDrawType) => usePlannerStore.getState().setMode({ kind: "draw", shape: fenceDrawType === "polygon" ? "polygon" : "circle", drawingFor: "geofence" })} />
            </CollapsibleSection>
          )}
          {showRally && (
            <CollapsibleSection title={tRally("title")} count={p.rallyPoints.length}>
              <RallyPointEditor />
            </CollapsibleSection>
          )}
          <CollapsibleSection title={tPoi("title")} count={poiCount}>
            <PoiEditor />
          </CollapsibleSection>
          <CollapsibleSection title={tTransform("title")}><TransformPanel /></CollapsibleSection>
        </PanelBand>
        <PanelBand title={t("bands.review")}>
          <CollapsibleSection title={tTerrain("title")} open={terrainOpen} onToggle={toggleTerrain}>
            <TerrainProfileChart waypoints={p.waypoints} />
          </CollapsibleSection>
          <CollapsibleSection title={tValidation("title")} open={validationOpen} onToggle={toggleValidation}>
            <ValidationPanel waypoints={p.waypoints}
              onSelectWaypoint={(id) => { p.setSelectedWaypoint(id); p.setExpandedWaypoint(id); }} />
          </CollapsibleSection>
          <SiteConditions first={p.waypoints[0]} />
          <CollapsibleSection title={t("energy.title")}>
            <EnergyCard waypoints={p.waypoints} cruiseSpeedMps={p.defaultSpeed} />
          </CollapsibleSection>
          <CollapsibleSection title={t("checklist.title")}>
            <PreflightChecklist />
          </CollapsibleSection>
        </PanelBand>
      </div>

      <input
        ref={boundaryInputRef}
        type="file"
        accept=".kml,.kmz,.zip,.shp"
        hidden
        onChange={(e) => { void handleBoundaryFile(e); }}
      />
      <MissionActions hasWaypoints={p.waypoints.length > 0} hasDrone={hasDrone} validationErrors={uploadErrorCount} uploadState={p.uploadState} downloadState={p.downloadState}
        isDirty={p.isDirty} onSave={p.handleSave} onUpload={p.handleUpload} onDownloadFromDrone={p.handleDownloadFromDrone}
        onExportWaypoints={p.handleExportWaypoints} onExportPlan={p.handleExportPlan} onExportKML={p.handleExportKML} onExportCSV={p.handleExportCSV}
        onExportKMZ={p.handleExportKMZ} onExportNative={p.handleExportNative}
        onExportBrief={handleExportBrief} onImportBoundary={handleImportBoundary} onCopyShareLink={handleCopyShareLink}
        onSaveAs={p.handleSaveAs} onReverseWaypoints={p.handleReverseWaypoints} onDiscard={p.handleClearAll} />
    </div>
  );
}

/**
 * Sun-times and weather cards for the plan site: the first waypoint, else the
 * map centre once it has moved off the null island (0,0). Renders nothing when
 * neither is available. It owns the map-centre subscription so panning the map
 * re-renders these two cards, not the whole panel.
 */
function SiteConditions({ first }: { first: Waypoint | undefined }) {
  const t = useTranslations("planner");
  const mapCenter = usePlannerStore((s) => s.mapCenter);
  const coords = first
    ? { lat: first.lat, lon: first.lon }
    : mapCenter && (mapCenter[0] !== 0 || mapCenter[1] !== 0)
      ? { lat: mapCenter[0], lon: mapCenter[1] }
      : null;
  if (!coords) return null;
  return (
    <>
      <CollapsibleSection title={t("sunTimes")}>
        <SunTimesCard lat={coords.lat} lon={coords.lon} />
      </CollapsibleSection>
      <CollapsibleSection title={t("weather.title")}>
        <WeatherCard lat={coords.lat} lon={coords.lon} />
      </CollapsibleSection>
    </>
  );
}
