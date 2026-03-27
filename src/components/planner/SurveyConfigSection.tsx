/**
 * @module SurveyConfigSection
 * @description Survey pattern configuration UI — camera profiles, GSD, overlap, advanced settings.
 * Extracted from PatternConfigSections.tsx.
 * @license GPL-3.0-only
 */
"use client";

import { useMemo, useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Toggle } from "@/components/ui/toggle";
import { usePatternStore } from "@/stores/pattern-store";
import { useDrawingStore } from "@/stores/drawing-store";
import { CAMERA_PROFILES, computeGSD, computeLineSpacing, computeTriggerDistance } from "@/lib/patterns/gsd-calculator";
import { Grid3X3, Camera, ChevronDown, SquareDashed } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { cn, randomId } from "@/lib/utils";
import {
  ENTRY_LOCATION_OPTIONS, CAMERA_OPTIONS,
  SURVEY_PRESET_OPTIONS, SURVEY_PRESETS,
} from "./pattern-editor-constants";

export function SurveyConfig() {
  const t = useTranslations("planner");
  const surveyConfig = usePatternStore((s) => s.surveyConfig);
  const updateSurveyConfig = usePatternStore((s) => s.updateSurveyConfig);
  const drawnPolygons = useDrawingStore((s) => s.polygons);
  const selectedPolygonIds = useDrawingStore((s) => s.selectedPolygonIds);
  const togglePolygonSelection = useDrawingStore((s) => s.togglePolygonSelection);

  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleQuickRect = useCallback(() => {
    const center: [number, number] = [12.9716, 77.5946]; // Bangalore default
    const offset = 0.001; // ~100m
    const vertices: [number, number][] = [
      [center[0] - offset, center[1] - offset],
      [center[0] - offset, center[1] + offset],
      [center[0] + offset, center[1] + offset],
      [center[0] + offset, center[1] - offset],
    ];
    const side = offset * 2 * 111320;
    const area = side * side * Math.cos(center[0] * Math.PI / 180);
    useDrawingStore.getState().addPolygon({ id: randomId(), vertices, area });
  }, []);

  const extConfig = surveyConfig as { _cameraName?: string; _sidelap?: number; _frontlap?: number; _preset?: string; crosshatch?: boolean };

  const selectedCamera = useMemo(
    () => CAMERA_PROFILES.find((c) => c.name === extConfig._cameraName),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [extConfig._cameraName]
  );

  const gsdInfo = useMemo(() => {
    if (!selectedCamera) return null;
    const alt = surveyConfig.altitude ?? 50;
    const gsd = computeGSD(alt, selectedCamera.focalLength, selectedCamera.sensorWidth, selectedCamera.imageWidth);
    return { gsd, camera: selectedCamera };
  }, [selectedCamera, surveyConfig.altitude]);

  const handleCameraChange = useCallback(
    (value: string) => {
      const camera = CAMERA_PROFILES.find((c) => c.name === value);
      if (camera) {
        const alt = surveyConfig.altitude ?? 50;
        const sidelap = 60;
        const frontlap = 70;
        const lineSpacing = computeLineSpacing(alt, camera, sidelap / 100);
        const triggerDist = computeTriggerDistance(alt, camera, frontlap / 100);
        updateSurveyConfig({
          lineSpacing: Math.round(lineSpacing * 10) / 10,
          cameraTriggerDistance: Math.round(triggerDist * 10) / 10,
          _cameraName: value,
          _sidelap: sidelap,
          _frontlap: frontlap,
        } as Partial<typeof surveyConfig>);
      } else {
        updateSurveyConfig({ _cameraName: "", _sidelap: undefined, _frontlap: undefined } as Partial<typeof surveyConfig>);
      }
    },
    [surveyConfig.altitude, updateSurveyConfig]
  );

  const handlePresetChange = useCallback(
    (value: string) => {
      const preset = SURVEY_PRESETS.find((p) => p.label === value);
      if (preset) {
        const updates: Record<string, unknown> = {
          altitude: preset.altitude,
          speed: preset.speed,
          _preset: preset.label,
          _sidelap: preset.sidelap,
          _frontlap: preset.frontlap,
        };
        if (preset.tieLines !== undefined) updates.tieLines = preset.tieLines;
        if (selectedCamera) {
          const ls = computeLineSpacing(preset.altitude, selectedCamera, preset.sidelap / 100);
          const td = computeTriggerDistance(preset.altitude, selectedCamera, preset.frontlap / 100);
          updates.lineSpacing = Math.round(ls * 10) / 10;
          updates.cameraTriggerDistance = Math.round(td * 10) / 10;
        }
        updateSurveyConfig(updates as Partial<typeof surveyConfig>);
      } else {
        updateSurveyConfig({ _preset: "" } as Partial<typeof surveyConfig>);
      }
    },
    [selectedCamera, updateSurveyConfig]
  );

  const handleSidelapChange = useCallback(
    (value: number) => {
      if (!selectedCamera) return;
      const alt = surveyConfig.altitude ?? 50;
      const ls = computeLineSpacing(alt, selectedCamera, value / 100);
      updateSurveyConfig({
        _sidelap: value,
        _preset: "",
        lineSpacing: Math.round(ls * 10) / 10,
      } as Partial<typeof surveyConfig>);
    },
    [selectedCamera, surveyConfig.altitude, updateSurveyConfig]
  );

  const handleFrontlapChange = useCallback(
    (value: number) => {
      if (!selectedCamera) return;
      const alt = surveyConfig.altitude ?? 50;
      const td = computeTriggerDistance(alt, selectedCamera, value / 100);
      updateSurveyConfig({
        _frontlap: value,
        _preset: "",
        cameraTriggerDistance: Math.round(td * 10) / 10,
      } as Partial<typeof surveyConfig>);
    },
    [selectedCamera, surveyConfig.altitude, updateSurveyConfig]
  );

  return (
    <>
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1.5 text-[10px] font-mono text-text-tertiary">
          <Grid3X3 size={12} />
          <span>
            {surveyConfig.polygon
              ? `${surveyConfig.polygon.length} vertices`
              : drawnPolygons.length > 0
                ? `${selectedPolygonIds.length} of ${drawnPolygons.length} polygon${drawnPolygons.length > 1 ? "s" : ""} selected`
                : t("drawPolygonOnMap")}
          </span>
          {!surveyConfig.polygon && drawnPolygons.length === 0 && (
            <button onClick={handleQuickRect}
              className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-mono text-accent-primary border border-accent-primary/30 hover:bg-accent-primary/10 transition-colors cursor-pointer"
              title="Create a 200m x 200m rectangle at default location">
              <SquareDashed size={10} /> Quick Rect
            </button>
          )}
        </div>
        {!surveyConfig.polygon && drawnPolygons.length > 1 && (
          <div className="flex flex-col gap-0.5 pl-4">
            {drawnPolygons.map((poly, i) => (
              <label key={poly.id} className="flex items-center gap-1.5 text-[10px] font-mono text-text-secondary cursor-pointer hover:text-text-primary">
                <input
                  type="checkbox"
                  checked={selectedPolygonIds.includes(poly.id)}
                  onChange={() => togglePolygonSelection(poly.id)}
                  className="accent-accent-primary w-3 h-3"
                />
                Polygon {i + 1} ({poly.vertices.length} pts)
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Preset dropdown */}
      <Select label={t("surveyPreset")} options={SURVEY_PRESET_OPTIONS}
        value={extConfig._preset ?? ""} onChange={handlePresetChange} />

      {/* Camera Profile */}
      <Select label={t("cameraProfile")} options={CAMERA_OPTIONS}
        value={extConfig._cameraName ?? ""} onChange={handleCameraChange} />
      {gsdInfo && (
        <Tooltip content="Ground Sample Distance. Lower = higher detail. 2 cm/px = excellent, 5 cm/px = typical survey, 10 cm/px = coarse overview." position="right">
          <div className="flex items-center gap-1.5 px-2 py-1 bg-accent-primary/10 border border-accent-primary/20 cursor-help">
            <Camera size={10} className="text-accent-primary shrink-0" />
            <span className="text-[10px] font-mono text-accent-primary">GSD: {(gsdInfo.gsd * 100).toFixed(2)} cm/px</span>
          </div>
        </Tooltip>
      )}

      {/* Sidelap/Frontlap (when camera selected) OR raw line spacing (fallback) */}
      {selectedCamera ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-1">
            <label className="flex items-center justify-between text-xs text-text-secondary">
              <span>Sidelap</span>
              <span className="font-mono text-text-primary">{extConfig._sidelap ?? 60}%</span>
            </label>
            <input type="range" min={20} max={95} step={5}
              value={extConfig._sidelap ?? 60}
              onChange={(e) => handleSidelapChange(parseInt(e.target.value))}
              className="w-full h-1 bg-bg-tertiary appearance-none cursor-pointer accent-accent-primary" />
            <span className="text-[9px] font-mono text-text-tertiary">Line spacing: {surveyConfig.lineSpacing ?? 25} m</span>
          </div>
          <div className="flex flex-col gap-1">
            <label className="flex items-center justify-between text-xs text-text-secondary">
              <span>Frontlap</span>
              <span className="font-mono text-text-primary">{extConfig._frontlap ?? 70}%</span>
            </label>
            <input type="range" min={20} max={95} step={5}
              value={extConfig._frontlap ?? 70}
              onChange={(e) => handleFrontlapChange(parseInt(e.target.value))}
              className="w-full h-1 bg-bg-tertiary appearance-none cursor-pointer accent-accent-primary" />
            <span className="text-[9px] font-mono text-text-tertiary">Trigger dist: {surveyConfig.cameraTriggerDistance ?? 0} m</span>
          </div>
        </div>
      ) : (
        <>
          <Input label={t("lineSpacing")} type="number" unit="m" value={String(surveyConfig.lineSpacing ?? 25)}
            onChange={(e) => updateSurveyConfig({ lineSpacing: parseFloat(e.target.value) || 25 })} />
        </>
      )}

      {/* Altitude + Speed (always visible) */}
      <div className="grid grid-cols-2 gap-2">
        <Input label="Altitude" type="number" unit="m" value={String(surveyConfig.altitude ?? 50)}
          onChange={(e) => {
            const alt = parseFloat(e.target.value) || 50;
            updateSurveyConfig({ altitude: alt });
            if (selectedCamera) {
              const sidelap = extConfig._sidelap ?? 60;
              const frontlap = extConfig._frontlap ?? 70;
              const ls = computeLineSpacing(alt, selectedCamera, sidelap / 100);
              const td = computeTriggerDistance(alt, selectedCamera, frontlap / 100);
              updateSurveyConfig({ lineSpacing: Math.round(ls * 10) / 10, cameraTriggerDistance: Math.round(td * 10) / 10 });
            }
          }} />
        <Input label="Speed" type="number" unit="m/s" value={String(surveyConfig.speed ?? 5)}
          onChange={(e) => updateSurveyConfig({ speed: parseFloat(e.target.value) || 5 })} />
      </div>

      {/* Advanced toggle */}
      <button onClick={() => setShowAdvanced(!showAdvanced)}
        className="flex items-center gap-1 text-[10px] font-mono text-text-tertiary hover:text-text-secondary w-full py-1 cursor-pointer">
        <ChevronDown size={10} className={cn("transition-transform", showAdvanced && "rotate-180")} />
        {showAdvanced ? t("hideAdvanced") : t("showAdvanced")}
      </button>

      {showAdvanced && (
        <>
          <Input label={t("gridAngle")} type="number" unit="deg" value={String(surveyConfig.gridAngle ?? 0)}
            onChange={(e) => updateSurveyConfig({ gridAngle: parseFloat(e.target.value) || 0 })} />
          <Input label={t("turnAroundDistance")} type="number" unit="m" value={String(surveyConfig.turnAroundDistance ?? 10)}
            onChange={(e) => updateSurveyConfig({ turnAroundDistance: parseFloat(e.target.value) || 10 })} />
          <Select label={t("entryPoint")} options={ENTRY_LOCATION_OPTIONS} value={surveyConfig.entryLocation ?? "topLeft"}
            onChange={(v) => updateSurveyConfig({ entryLocation: v as "topLeft" | "topRight" | "bottomLeft" | "bottomRight" })} />
          <Toggle label={t("alternateTransects")} checked={surveyConfig.flyAlternateTransects ?? false}
            onChange={(v) => updateSurveyConfig({ flyAlternateTransects: v })} />
          <Toggle label={t("crosshatch")} checked={extConfig.crosshatch ?? false}
            onChange={(v) => updateSurveyConfig({ crosshatch: v, tieLines: false } as Partial<typeof surveyConfig>)} />
          <Toggle label={t("tieLines")} checked={surveyConfig.tieLines ?? false}
            onChange={(v) => updateSurveyConfig({ tieLines: v })}
            disabled={extConfig.crosshatch === true} />
          {surveyConfig.tieLines && (
            <div className="grid grid-cols-2 gap-2">
              <Input label={t("tieAngle")} type="number" unit="deg" value={String(surveyConfig.tieLineAngle ?? 90)}
                onChange={(e) => updateSurveyConfig({ tieLineAngle: parseFloat(e.target.value) || 90 })} />
              <Input label={t("tieSpacing")} type="number" unit="m" value={String(surveyConfig.tieLineSpacing ?? 25)}
                onChange={(e) => updateSurveyConfig({ tieLineSpacing: parseFloat(e.target.value) || 25 })} />
            </div>
          )}
          <Input label={t("cameraTriggerDist")} type="number" unit="m" placeholder="0 = off"
            value={String(surveyConfig.cameraTriggerDistance ?? 0)}
            onChange={(e) => updateSurveyConfig({ cameraTriggerDistance: parseFloat(e.target.value) || 0 })} />
        </>
      )}
    </>
  );
}
