/**
 * @module PatternEditor
 * @description Right panel section for configuring flight patterns (survey, orbit, corridor, SAR, structure scan).
 * Shows relevant controls based on active pattern type, generation stats, and Generate/Clear buttons.
 * Integrates GSD calculator for survey mode: camera profile dropdown auto-computes line spacing.
 * @license GPL-3.0-only
 */
"use client";

import { useCallback, useEffect, useMemo } from "react";
import { Select } from "@/components/ui/select";
import { usePatternStore } from "@/stores/pattern-store";
import { useDrawingStore } from "@/stores/drawing-store";
import { formatDistance, formatArea } from "@/lib/drawing/geo-utils";
import { Play, Trash2, AlertTriangle, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { PATTERN_TYPE_OPTIONS, VALID_PATTERN_TYPES } from "./pattern-editor-constants";
import {
  SurveyConfig, OrbitConfig, CorridorConfig,
  SarExpandingSquareConfig, SarSectorSearchConfig, SarParallelTrackConfig,
  StructureScanConfig,
} from "./PatternConfigSections";

interface PatternEditorProps {
  onApply?: () => void;
}

export function PatternEditor({ onApply }: PatternEditorProps) {
  const activeType = usePatternStore((s) => s.activePatternType);
  const setPatternType = usePatternStore((s) => s.setPatternType);
  const surveyConfig = usePatternStore((s) => s.surveyConfig);
  const orbitConfig = usePatternStore((s) => s.orbitConfig);
  const structureScanConfig = usePatternStore((s) => s.structureScanConfig);
  const corridorConfig = usePatternStore((s) => s.corridorConfig);
  const sarExpandingSquareConfig = usePatternStore((s) => s.sarExpandingSquareConfig);
  const sarSectorSearchConfig = usePatternStore((s) => s.sarSectorSearchConfig);
  const sarParallelTrackConfig = usePatternStore((s) => s.sarParallelTrackConfig);
  const generate = usePatternStore((s) => s.generate);
  const clear = usePatternStore((s) => s.clear);
  const patternResult = usePatternStore((s) => s.patternResult);
  const isGenerating = usePatternStore((s) => s.isGenerating);
  const error = usePatternStore((s) => s.error);

  const polygons = useDrawingStore((s) => s.polygons);
  const circles = useDrawingStore((s) => s.circles);

  const handleTypeChange = useCallback(
    (value: string) => {
      if (VALID_PATTERN_TYPES.has(value)) setPatternType(value as typeof activeType);
    },
    [setPatternType]
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
      default: return false;
    }
  }, [activeType, surveyConfig.polygon, polygons.length, orbitConfig.center, circles.length,
    structureScanConfig.structurePolygon, corridorConfig.pathPoints,
    sarExpandingSquareConfig?.center, sarSectorSearchConfig?.center, sarParallelTrackConfig?.startPoint]);

  // Stable config fingerprint — only re-generate when the ACTIVE config's values change
  const configKey = useMemo(() => {
    if (!activeType) return "";
    const cfg = activeType === "survey" ? surveyConfig
      : activeType === "orbit" ? orbitConfig
      : activeType === "corridor" ? corridorConfig
      : activeType === "expandingSquare" ? sarExpandingSquareConfig
      : activeType === "sectorSearch" ? sarSectorSearchConfig
      : activeType === "parallelTrack" ? sarParallelTrackConfig
      : structureScanConfig;
    return JSON.stringify(cfg);
  }, [activeType, surveyConfig, orbitConfig, corridorConfig, structureScanConfig,
    sarExpandingSquareConfig, sarSectorSearchConfig, sarParallelTrackConfig]);

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
        <Select label="Pattern Type" options={PATTERN_TYPE_OPTIONS} value="" onChange={handleTypeChange} placeholder="Select pattern..." />
        <p className="text-[10px] font-mono text-text-tertiary mt-2">
          Draw a polygon or circle on the map, then select a pattern type to generate waypoints.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 px-3 py-2">
      <Select label="Pattern Type" options={PATTERN_TYPE_OPTIONS} value={activeType} onChange={handleTypeChange} />
      {activeType === "survey" && <SurveyConfig />}
      {activeType === "orbit" && <OrbitConfig />}
      {activeType === "corridor" && <CorridorConfig />}
      {activeType === "expandingSquare" && <SarExpandingSquareConfig />}
      {activeType === "sectorSearch" && <SarSectorSearchConfig />}
      {activeType === "parallelTrack" && <SarParallelTrackConfig />}
      {activeType === "structureScan" && <StructureScanConfig />}

      {/* Readiness indicator */}
      <div className="flex items-center gap-1.5 px-2 py-1">
        {isGenerating ? (
          <>
            <div className="w-1.5 h-1.5 rounded-full bg-accent-primary animate-pulse" />
            <span className="text-[10px] font-mono text-accent-primary">Generating...</span>
          </>
        ) : hasGeometry ? (
          <>
            <div className="w-1.5 h-1.5 rounded-full bg-status-success" />
            <span className="text-[10px] font-mono text-status-success">Ready</span>
          </>
        ) : (
          <>
            <div className="w-1.5 h-1.5 rounded-full bg-status-warning" />
            <span className="text-[10px] font-mono text-status-warning">
              {activeType === "survey" || activeType === "structureScan" ? "Draw polygon first" :
               activeType === "orbit" ? "Draw circle first" :
               activeType === "corridor" ? "Set path points" : "Set datum point"}
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
          <Play size={12} />{isGenerating ? "Generating..." : "Generate"}
        </button>
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
            "bg-accent-lime/20 text-accent-lime border border-accent-lime/30 hover:bg-accent-lime/30 transition-colors cursor-pointer"
          )}>
          <Check size={12} />Apply to Mission ({patternResult.waypoints.length} WP)
        </button>
      )}

      {/* Pattern stats */}
      {patternResult && (
        <div className="border border-border-default p-2">
          <div className="text-[10px] font-mono text-text-tertiary mb-1">Pattern Stats</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] font-mono">
            <span className="text-text-secondary">Distance</span>
            <span className="text-text-primary">{formatDistance(patternResult.stats.totalDistance)}</span>
            <span className="text-text-secondary">Est. Time</span>
            <span className="text-text-primary">{Math.floor(patternResult.stats.estimatedTime / 60)}m {Math.round(patternResult.stats.estimatedTime % 60)}s</span>
            <span className="text-text-secondary">Waypoints</span>
            <span className="text-text-primary">{patternResult.waypoints.length}</span>
            {patternResult.stats.photoCount > 0 && (<>
              <span className="text-text-secondary">Photos</span>
              <span className="text-text-primary">{patternResult.stats.photoCount}</span>
            </>)}
            {patternResult.stats.coveredArea > 0 && (<>
              <span className="text-text-secondary">Area</span>
              <span className="text-text-primary">{formatArea(patternResult.stats.coveredArea)}</span>
            </>)}
            {patternResult.stats.transectCount > 0 && (<>
              <span className="text-text-secondary">Transects</span>
              <span className="text-text-primary">{patternResult.stats.transectCount}</span>
            </>)}
          </div>
        </div>
      )}
    </div>
  );
}
