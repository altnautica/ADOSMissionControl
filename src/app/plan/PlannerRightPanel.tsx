/**
 * @module PlannerRightPanel
 * @description Right side panel for the mission planner page containing all collapsible sections.
 * @license GPL-3.0-only
 */
"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronRight, Plus } from "lucide-react";
import { MissionEditor } from "@/components/planner/MissionEditor";
import { WaypointList } from "@/components/planner/WaypointList";
import { GeofenceEditor } from "@/components/planner/GeofenceEditor";
import { DefaultsSection } from "@/components/planner/DefaultsSection";
import { RallyPointEditor } from "@/components/planner/RallyPointEditor";
import { ValidationPanel } from "@/components/planner/ValidationPanel";
import { TerrainProfileChart } from "@/components/planner/TerrainProfileChart";
import { TransformPanel } from "@/components/planner/TransformPanel";
import { PatternEditor } from "@/components/planner/PatternEditor";
import { BatchEditor } from "@/components/planner/BatchEditor";
import { MissionActions } from "@/components/planner/MissionActions";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { usePlannerStore } from "@/stores/planner-store";
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
  const tTerrain = useTranslations("terrain");
  const tTransform = useTranslations("transform");
  const tValidation = useTranslations("validation");
  const selectedWaypointIds = usePlannerStore((s) => s.selectedWaypointIds);
  const clearMultiSelection = usePlannerStore((s) => s.clearMultiSelection);

  const activePlanName = p.activePlanId ? p.missionName || t("untitledMission") : null;

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
        <CollapsibleSection title={t("missionSetup")} defaultOpen={true}>
          <MissionEditor drones={p.drones} missionName={p.missionName} selectedDroneId={p.selectedDroneId} suiteType={p.suiteType}
            onNameChange={p.setMissionName} onDroneChange={p.setSelectedDroneId} onSuiteChange={p.setSuiteType} />
        </CollapsibleSection>
        <CollapsibleSection title={t("defaults")}>
          <DefaultsSection defaultAlt={p.defaultAlt} defaultSpeed={p.defaultSpeed} defaultAcceptRadius={p.defaultAcceptRadius} defaultFrame={p.defaultFrame}
            onAltChange={(v) => p.setDefaults({ defaultAlt: v })} onSpeedChange={(v) => p.setDefaults({ defaultSpeed: v })}
            onRadiusChange={(v) => p.setDefaults({ defaultAcceptRadius: v })} onFrameChange={(v) => p.setDefaults({ defaultFrame: v })} />
        </CollapsibleSection>
        <CollapsibleSection title={t("flightPatterns")} open={patternOpen} onToggle={togglePattern}>
          <PatternEditor onApply={p.handlePatternApply} />
        </CollapsibleSection>
        <CollapsibleSection title={t("waypoints")} defaultOpen={true} count={p.waypoints.length}
          trailing={<button onClick={p.handleAddManualWaypoint} className="text-text-tertiary hover:text-accent-primary cursor-pointer"><Plus size={14} /></button>}>
          <WaypointList waypoints={p.waypoints} selectedId={p.selectedWaypointId} expandedId={p.expandedWaypointId}
            onSelect={p.handleWaypointClick} onExpand={p.setExpandedWaypoint} onUpdate={p.updateWaypoint}
            onRemove={p.removeWaypoint} onReorder={p.reorderWaypoints} onAddManual={p.handleAddManualWaypoint} />
        </CollapsibleSection>
        {selectedWaypointIds.length >= 2 && (
          <CollapsibleSection title={t("batchEdit")} defaultOpen={true}>
            <BatchEditor selectedIds={selectedWaypointIds} onClearSelection={clearMultiSelection} />
          </CollapsibleSection>
        )}
        {showGeofence && (
          <CollapsibleSection title={tGeo("title")} trailing={<span className="text-[10px] font-mono text-text-tertiary">{p.geofenceEnabled ? t("on") : t("off")}</span>}>
            <GeofenceEditor enabled={p.geofenceEnabled} onToggle={p.setGeofenceEnabled} type={p.geofenceType} onTypeChange={p.setGeofenceType}
              maxAlt={p.geofenceMaxAlt} onMaxAltChange={p.setGeofenceMaxAlt} action={p.geofenceAction} onActionChange={p.setGeofenceAction}
              onDrawOnMap={(fenceDrawType) => p.setActiveTool(fenceDrawType === "polygon" ? "polygon" : "circle")} />
          </CollapsibleSection>
        )}
        {showRally && (
          <CollapsibleSection title={tRally("title")} count={p.rallyPoints.length}>
            <RallyPointEditor addingRallyPoint={p.addingRallyPoint} onToggleAdding={p.setAddingRallyPoint} />
          </CollapsibleSection>
        )}
        <CollapsibleSection title={tTerrain("title")} open={terrainOpen} onToggle={toggleTerrain}>
          <TerrainProfileChart waypoints={p.waypoints} />
        </CollapsibleSection>
        <CollapsibleSection title={tTransform("title")}><TransformPanel /></CollapsibleSection>
        <CollapsibleSection title={tValidation("title")} open={validationOpen} onToggle={toggleValidation}>
          <ValidationPanel waypoints={p.waypoints} geofenceEnabled={p.geofenceEnabled} geofenceMaxAlt={p.geofenceMaxAlt}
            onSelectWaypoint={(id) => { p.setSelectedWaypoint(id); p.setExpandedWaypoint(id); }} />
        </CollapsibleSection>
      </div>

      <MissionActions hasWaypoints={p.waypoints.length > 0} hasDrone={hasDrone} uploadState={p.uploadState} downloadState={p.downloadState}
        isDirty={p.isDirty} onSave={p.handleSave} onUpload={p.handleUpload} onDownloadFromDrone={p.handleDownloadFromDrone}
        onExportWaypoints={p.handleExportWaypoints} onExportPlan={p.handleExportPlan} onExportKML={p.handleExportKML} onExportCSV={p.handleExportCSV}
        onSaveAs={p.handleSaveAs} onReverseWaypoints={p.handleReverseWaypoints} onDiscard={p.handleClearAll} />
    </div>
  );
}
