/**
 * @module PatternEditor
 * @description Right panel section for configuring flight patterns (survey, orbit, corridor, SAR, structure scan).
 * Shows relevant controls based on active pattern type, generation stats, and Generate/Clear buttons.
 * Integrates GSD calculator for survey mode: camera profile dropdown auto-computes line spacing.
 * @license GPL-3.0-only
 */
"use client";

import { useCallback, useEffect, useMemo } from "react";
import { useTranslations } from "next-intl";
import { Select } from "@/components/ui/select";
import { usePatternStore } from "@/stores/pattern-store";
import { selectPatternType } from "@/stores/pattern-selection";
import { useDrawingStore } from "@/stores/drawing-store";
import { useSettingsStore } from "@/stores/settings-store";
import { formatDistance, formatArea } from "@/lib/units/format";
import { Play, Trash2, AlertTriangle, Check, X, Puzzle } from "lucide-react";
import { cn } from "@/lib/utils";
import { FleetPluginSlot } from "@/components/plugins/FleetPluginSlot";
import { useFleetPluginContributions } from "@/hooks/use-fleet-plugin-contributions";
import { PATTERN_TYPE_OPTIONS, VALID_PATTERN_TYPES } from "./pattern-editor-constants";
import {
  SurveyConfig, OrbitConfig, CorridorConfig,
  SarExpandingSquareConfig, SarSectorSearchConfig, SarParallelTrackConfig,
  StructureScanConfig,
} from "./PatternConfigSections";
import { FixedWingLandingConfig } from "./FixedWingLandingConfigSection";
import { VtolLandingConfig } from "./VtolLandingConfigSection";
import type { SurveyConfig as SurveyConfigType } from "@/lib/patterns/types";
import { CAMERA_PROFILES, computeLineSpacing, computeTriggerDistance } from "@/lib/patterns/gsd-calculator";

/** Survey config plus the planner's UI-only overlap / camera helper fields. */
type SurveyDeliverableConfig = Partial<SurveyConfigType> & {
  _sidelap?: number;
  _frontlap?: number;
  _preset?: string;
  _cameraName?: string;
};

interface PatternEditorProps {
  onApply?: () => void;
}

// Survey overlap presets by target deliverable; each sets side/front overlap.
const SURVEY_DELIVERABLE_PRESETS = [
  { key: "orthomosaic", labelKey: "presetOrthomosaic", sideOverlap: 70, frontOverlap: 70 },
  { key: "model3d", labelKey: "presetModel3d", sideOverlap: 80, frontOverlap: 80 },
  { key: "fastLowDetail", labelKey: "presetFastLowDetail", sideOverlap: 60, frontOverlap: 60 },
] as const;

export function PatternEditor({ onApply }: PatternEditorProps) {
  const t = useTranslations("planner");
  const units = useSettingsStore((s) => s.units);
  const activeType = usePatternStore((s) => s.activePatternType);
  const surveyConfig = usePatternStore((s) => s.surveyConfig);
  const orbitConfig = usePatternStore((s) => s.orbitConfig);
  const structureScanConfig = usePatternStore((s) => s.structureScanConfig);
  const corridorConfig = usePatternStore((s) => s.corridorConfig);
  const sarExpandingSquareConfig = usePatternStore((s) => s.sarExpandingSquareConfig);
  const sarSectorSearchConfig = usePatternStore((s) => s.sarSectorSearchConfig);
  const sarParallelTrackConfig = usePatternStore((s) => s.sarParallelTrackConfig);
  const fixedWingLandingConfig = usePatternStore((s) => s.fixedWingLandingConfig);
  const vtolLandingConfig = usePatternStore((s) => s.vtolLandingConfig);
  const generate = usePatternStore((s) => s.generate);
  const clear = usePatternStore((s) => s.clear);
  const patternResult = usePatternStore((s) => s.patternResult);
  const isGenerating = usePatternStore((s) => s.isGenerating);
  const error = usePatternStore((s) => s.error);

  const polygons = useDrawingStore((s) => s.polygons);
  const circles = useDrawingStore((s) => s.circles);

  const handleTypeChange = useCallback(
    (value: string) => {
      if (VALID_PATTERN_TYPES.has(value)) selectPatternType(value as typeof activeType);
    },
    []
  );

  const handleGenerate = useCallback(() => {
    generate();
  }, [generate]);

  // Compute whether geometry is available for the active pattern type
  const hasGeometry = useMemo(() => {
    if (!activeType) return false;
    switch (activeType) {
      case "survey": return !!(surveyConfig.polygon || polygons.length > 0);
      case "orbit": return !!(orbitConfig.center || circles.length > 0);
      case "structureScan": return !!(structureScanConfig.structurePolygon || polygons.length > 0);
      case "corridor": return !!corridorConfig.pathPoints;
      case "expandingSquare": return !!sarExpandingSquareConfig?.center;
      case "sectorSearch": return !!sarSectorSearchConfig?.center;
      case "parallelTrack": return !!sarParallelTrackConfig?.startPoint;
      case "fixedWingLanding": return !!fixedWingLandingConfig?.landingPoint;
      case "vtolLanding": return !!vtolLandingConfig?.landingPoint;
      default: return false;
    }
  }, [activeType, surveyConfig.polygon, polygons.length, orbitConfig.center, circles.length,
    structureScanConfig.structurePolygon, corridorConfig.pathPoints,
    sarExpandingSquareConfig?.center, sarSectorSearchConfig?.center, sarParallelTrackConfig?.startPoint,
    fixedWingLandingConfig?.landingPoint, vtolLandingConfig?.landingPoint]);

  // Stable config fingerprint — only re-generate when the ACTIVE config's values change
  const configKey = useMemo(() => {
    if (!activeType) return "";
    const cfg = activeType === "survey" ? surveyConfig
      : activeType === "orbit" ? orbitConfig
      : activeType === "corridor" ? corridorConfig
      : activeType === "expandingSquare" ? sarExpandingSquareConfig
      : activeType === "sectorSearch" ? sarSectorSearchConfig
      : activeType === "parallelTrack" ? sarParallelTrackConfig
      : activeType === "fixedWingLanding" ? fixedWingLandingConfig
      : activeType === "vtolLanding" ? vtolLandingConfig
      : structureScanConfig;
    return JSON.stringify(cfg);
  }, [activeType, surveyConfig, orbitConfig, corridorConfig, structureScanConfig,
    sarExpandingSquareConfig, sarSectorSearchConfig, sarParallelTrackConfig,
    fixedWingLandingConfig, vtolLandingConfig]);

  // Auto-generate on config/geometry change (300ms debounce)
  useEffect(() => {
    if (!activeType || !hasGeometry) return;
    const timer = setTimeout(() => generate(), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeType, configKey, polygons.length, circles.length, generate]);

  if (!activeType) {
    return (
      <div className="px-3 py-2">
        <Select label={t("patternType")} options={PATTERN_TYPE_OPTIONS} value="" onChange={handleTypeChange} placeholder={t("selectPattern")} />
        <p className="text-[10px] font-mono text-text-tertiary mt-2">
          {t("drawPatternHint")}
        </p>
        <PluginMissionTemplates />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 px-3 py-2">
      <Select label={t("patternType")} options={PATTERN_TYPE_OPTIONS} value={activeType} onChange={handleTypeChange} />
      {activeType === "survey" && <SurveyConfig />}
      {activeType === "survey" && <SurveyDeliverablePresets />}
      {activeType === "orbit" && <OrbitConfig />}
      {activeType === "corridor" && <CorridorConfig />}
      {activeType === "expandingSquare" && <SarExpandingSquareConfig />}
      {activeType === "sectorSearch" && <SarSectorSearchConfig />}
      {activeType === "parallelTrack" && <SarParallelTrackConfig />}
      {activeType === "structureScan" && <StructureScanConfig />}
      {activeType === "fixedWingLanding" && <FixedWingLandingConfig />}
      {activeType === "vtolLanding" && <VtolLandingConfig />}

      {/* Readiness indicator */}
      <div className="flex items-center gap-1.5 px-2 py-1">
        {isGenerating ? (
          <>
            <div className="w-1.5 h-1.5 rounded-full bg-accent-primary animate-pulse" />
            <span className="text-[10px] font-mono text-accent-primary">{t("generating")}</span>
          </>
        ) : hasGeometry ? (
          <>
            <div className="w-1.5 h-1.5 rounded-full bg-status-success" />
            <span className="text-[10px] font-mono text-status-success">{t("ready")}</span>
          </>
        ) : (
          <>
            <div className="w-1.5 h-1.5 rounded-full bg-status-warning" />
            <span className="text-[10px] font-mono text-status-warning">
              {activeType === "survey" || activeType === "structureScan" ? t("drawPolygonFirst") :
               activeType === "orbit" ? t("drawCircleFirst") :
               activeType === "corridor" ? t("setPathPoints") :
               activeType === "parallelTrack" ? t("setStartPoint") :
               activeType === "fixedWingLanding" || activeType === "vtolLanding" ? t("setLandingPoint") : t("setDatumPoint")}
            </span>
          </>
        )}
      </div>

      {/* Generate / Clear buttons */}
      <div className="flex gap-2">
        <button onClick={handleGenerate} disabled={isGenerating}
          className={cn(
            "flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-mono font-semibold transition-colors cursor-pointer",
            "bg-accent-primary/20 text-accent-primary border border-accent-primary/30 hover:bg-accent-primary/30",
            isGenerating && "opacity-50 cursor-wait"
          )}>
          <Play size={12} />{isGenerating ? t("generating") : t("generatePattern")}
        </button>
        {(polygons.length > 0 || circles.length > 0) && (
          <button onClick={() => useDrawingStore.getState().clearAll()}
            className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-mono text-text-secondary border border-border-default hover:bg-bg-tertiary transition-colors cursor-pointer"
            title="Clear drawn shapes">
            <X size={12} /> Shapes
          </button>
        )}
        <button onClick={clear}
          className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-mono text-text-secondary border border-border-default hover:bg-bg-tertiary transition-colors cursor-pointer">
          <Trash2 size={12} />
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-1.5 px-2 py-1.5 bg-status-error/10 border border-status-error/20">
          <AlertTriangle size={12} className="text-status-error shrink-0" />
          <span className="text-[10px] font-mono text-status-error">{error}</span>
        </div>
      )}

      {/* Apply button (above stats for prominence) */}
      {patternResult && onApply && (
        <button onClick={onApply}
          className={cn(
            "w-full flex items-center justify-center gap-1.5 py-2 text-xs font-mono font-semibold",
            "bg-accent-secondary/20 text-accent-secondary border border-accent-secondary/30 hover:bg-accent-secondary/30 transition-colors cursor-pointer"
          )}>
          <Check size={12} />{t("applyToMission", { count: patternResult.waypoints.length })}
        </button>
      )}

      {/* Pattern stats */}
      {patternResult && (
        <div className="border border-border-default p-2">
          <div className="text-[10px] font-mono text-text-tertiary mb-1">{t("patternStats")}</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] font-mono">
            <span className="text-text-secondary">{t("distance")}</span>
            <span className="text-text-primary">{formatDistance(patternResult.stats.totalDistance, units)}</span>
            <span className="text-text-secondary">{t("estimatedTime")}</span>
            <span className="text-text-primary">{Math.floor(patternResult.stats.estimatedTime / 60)}m {Math.round(patternResult.stats.estimatedTime % 60)}s</span>
            <span className="text-text-secondary">{t("waypoints")}</span>
            <span className="text-text-primary">{patternResult.waypoints.length}</span>
            {patternResult.stats.photoCount > 0 && (<>
              <span className="text-text-secondary">{t("photos")}</span>
              <span className="text-text-primary">{patternResult.stats.photoCount}</span>
            </>)}
            {patternResult.stats.coveredArea > 0 && (<>
              <span className="text-text-secondary">{t("area")}</span>
              <span className="text-text-primary">{formatArea(patternResult.stats.coveredArea, units)}</span>
            </>)}
            {patternResult.stats.transectCount > 0 && (<>
              <span className="text-text-secondary">{t("transects")}</span>
              <span className="text-text-primary">{patternResult.stats.transectCount}</span>
            </>)}
          </div>
        </div>
      )}

      <PluginMissionTemplates />
    </div>
  );
}

// A row of one-click survey overlap presets, shown only while survey is active.
export function SurveyDeliverablePresets() {
  const t = useTranslations("planner");
  const apply = useCallback((sideOverlap: number, frontOverlap: number) => {
    const store = usePatternStore.getState();
    const cfg = store.surveyConfig as SurveyDeliverableConfig;
    const camera = cfg._cameraName ? CAMERA_PROFILES.find((c) => c.name === cfg._cameraName) : undefined;
    const update: SurveyDeliverableConfig = { _sidelap: sideOverlap, _frontlap: frontOverlap, _preset: "" };
    // A preset only changes the deliverable if it recomputes the grid geometry
    // the generator actually reads. Side overlap drives line spacing, front
    // overlap drives the camera trigger distance — exactly as the manual overlap
    // controls do. With no camera selected we set only the overlap fields (no
    // fabricated spacing).
    if (camera) {
      const alt = cfg.altitude ?? 50;
      update.lineSpacing = Math.round(computeLineSpacing(alt, camera, sideOverlap / 100) * 10) / 10;
      update.cameraTriggerDistance = Math.round(computeTriggerDistance(alt, camera, frontOverlap / 100) * 10) / 10;
    }
    store.updateSurveyConfig(update as Partial<SurveyConfigType>);
  }, []);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-mono uppercase tracking-wider text-text-tertiary">{t("deliverablePresets")}</span>
      <div className="flex gap-1.5">
        {SURVEY_DELIVERABLE_PRESETS.map((p) => (
          <button key={p.key} onClick={() => apply(p.sideOverlap, p.frontOverlap)}
            className="flex-1 py-1 text-[10px] font-mono text-text-secondary border border-border-default hover:bg-bg-tertiary hover:text-text-primary transition-colors cursor-pointer">
            {t(p.labelKey)}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The fleet `mission.template` slot in the planner gallery. A GCS-level plugin
 * that contributes a `mission.template` gets its sandboxed iframe mounted here
 * under an "Extensions" heading. Inert until a plugin contributes.
 */
function PluginMissionTemplates() {
  // Gate before useTranslations so a planner test with no plugin (and no intl
  // provider) never invokes the intl hook.
  const contributions = useFleetPluginContributions("mission.template");
  if (contributions.length === 0) return null;
  return <PluginMissionTemplatesBody />;
}

function PluginMissionTemplatesBody() {
  const t = useTranslations("plugins");
  return (
    <div className="mt-3 space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Puzzle size={12} className="text-accent-primary" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
          {t("missionTemplatesHeading")}
        </span>
      </div>
      <FleetPluginSlot
        name="mission.template"
        className="space-y-2"
        iframeClassName="w-full h-40 border border-border-default rounded bg-bg-secondary"
      />
    </div>
  );
}
