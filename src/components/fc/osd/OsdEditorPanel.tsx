"use client";

/**
 * ArduPilot OSD layout editor. Reads and writes OSDn_<ITEM>_EN/_X/_Y for the
 * selected screen through usePanelParams; items the vehicle's build does not
 * have are absent from the parameter set and are not shown.
 *
 * @license GPL-3.0-only
 */

import { useState, useCallback, useMemo } from "react";
import { useToast } from "@/components/ui/toast";
import { useDroneManager } from "@/stores/drone-manager";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { usePanelParams } from "@/hooks/use-panel-params";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { useFlashCommitToast } from "@/hooks/use-flash-commit-toast";
import { ArmedLockOverlay } from "@/components/indicators/ArmedLockOverlay";
import { OsdElementGrid } from "./OsdElementGrid";
import { OsdScreenPreview, FORMAT_ROWS } from "./OsdScreenPreview";
import {
  AP_OSD_ELEMENTS, PRESETS, OSD_MAX_COL, OSD_MAX_ROW, osdElementParams, osdScreenParamNames,
  type OsdElement, type VideoFormat,
} from "./ap-osd-elements";

// Live telemetry preview values for OSD elements
function useLiveTelemetryPreview(): Record<string, string> {
  const vfr = useTelemetryStore((s) => s.vfr);
  const battery = useTelemetryStore((s) => s.battery);
  const gps = useTelemetryStore((s) => s.gps);
  const position = useTelemetryStore((s) => s.position);

  return useMemo(() => {
    const v = vfr.latest();
    const b = battery.latest();
    const g = gps.latest();
    const p = position.latest();
    return {
      ALTITUDE: v ? `${v.alt.toFixed(0)}m` : "ALT",
      BAT_VOLT: b ? `${b.voltage.toFixed(1)}V` : "BATT",
      CURRENT: b ? `${b.current.toFixed(1)}A` : "AMP",
      SATS: g ? `${g.satellites}` : "SAT",
      GSPEED: v ? `${v.groundspeed.toFixed(1)}` : "GS",
      COMPASS: p ? `${p.heading.toFixed(0)}°` : "CMP",
      ASPEED: v ? `${v.airspeed.toFixed(1)}` : "AS",
      VSPEED: v ? `${v.climb.toFixed(1)}` : "VS",
      THROTTLE: v ? `${v.throttle}%` : "THR",
      HEADING: p ? `${p.heading.toFixed(0)}°` : "HDG",
      POWER: b ? `${(b.voltage * b.current).toFixed(0)}W` : "PWR",
      BATTBAR: b && b.remaining >= 0 ? `${b.remaining}%` : "BAR",
      BATUSED: b ? `${b.consumed.toFixed(0)}` : "mAh",
      CLK: new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" }),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vfr.length, battery.length, gps.length, position.length]);
}

interface ScreenEditorProps {
  screen: number;
  onScreenChange: (screen: number) => void;
  videoFormat: VideoFormat;
  onFormatChange: (format: VideoFormat) => void;
  clipboard: OsdElement[] | null;
  onCopy: (elements: OsdElement[]) => void;
}

/** One OSD screen, bound to that screen's parameters. Keyed by screen so each loads its own set. */
function ScreenEditor({ screen, onScreenChange, videoFormat, onFormatChange, clipboard, onCopy }: ScreenEditorProps) {
  const selectedDroneId = useDroneManager((s) => s.selectedDroneId);
  const { toast } = useToast();
  const { showFlashResult } = useFlashCommitToast();
  const [saving, setSaving] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [livePreview, setLivePreview] = useState(false);
  const liveTelemetry = useLiveTelemetryPreview();

  const optionalParams = useMemo(() => osdScreenParamNames(screen), [screen]);
  const { params, dirtyParams, hasRamWrites, hasLoaded, setLocalValue, saveAllToRam, commitToFlash } = usePanelParams({
    paramNames: [], optionalParams, panelId: `ap-osd-${screen}`, autoLoad: true,
  });
  useUnsavedGuard(dirtyParams.size > 0);

  const elements = useMemo<OsdElement[]>(() => AP_OSD_ELEMENTS.flatMap((def) => {
    const p = osdElementParams(screen, def.id);
    const en = params.get(p.en);
    if (en === undefined) return [];
    return [{
      id: def.id, label: def.label, shortLabel: def.shortLabel,
      enabled: en === 1, col: params.get(p.x) ?? def.col, row: params.get(p.y) ?? def.row,
    }];
  }), [params, screen]);

  const screenEnable = params.get(`OSD${screen}_ENABLE`);

  const place = useCallback((id: string, next: { enabled?: boolean; row?: number; col?: number }) => {
    const p = osdElementParams(screen, id);
    if (next.enabled !== undefined && params.has(p.en)) setLocalValue(p.en, next.enabled ? 1 : 0);
    if (next.col !== undefined && params.has(p.x)) setLocalValue(p.x, Math.min(OSD_MAX_COL, Math.max(0, next.col)));
    if (next.row !== undefined && params.has(p.y)) setLocalValue(p.y, Math.min(OSD_MAX_ROW, Math.max(0, next.row)));
  }, [params, screen, setLocalValue]);

  const toggleElement = (id: string) => {
    const el = elements.find((e) => e.id === id);
    if (el) place(id, { enabled: !el.enabled });
  };

  const loadPreset = (presetName: string) => {
    const preset = PRESETS[presetName];
    if (!preset) return;
    for (const el of elements) place(el.id, preset[el.id] ?? { enabled: false });
  };

  const pasteScreen = () => {
    if (!clipboard) return;
    const maxRow = FORMAT_ROWS[videoFormat] - 1;
    for (const el of clipboard) place(el.id, { enabled: el.enabled, col: el.col, row: Math.min(el.row, maxRow) });
    toast(`Pasted to screen ${screen}`, "success");
  };

  const handleReset = () => {
    for (const def of AP_OSD_ELEMENTS) place(def.id, { row: def.row, col: def.col });
  };

  const handleSave = async () => {
    setSaving(true);
    const ok = await saveAllToRam();
    setSaving(false);
    if (ok) toast(`OSD screen ${screen} saved to flight controller`, "success");
    else toast("Some OSD parameters failed to save", "error");
  };

  const handleFlash = async () => {
    showFlashResult(await commitToFlash(), { successMessage: "Written to flash — persists after reboot" });
  };

  const handleElementMove = useCallback((id: string, row: number, col: number) => {
    const el = elements.find((e) => e.id === id);
    if (el && (el.row !== row || el.col !== col)) place(id, { row, col });
  }, [elements, place]);

  const noOsdParams = hasLoaded && elements.length === 0;

  return (
    <div className="h-full flex">
      <OsdElementGrid
        elements={elements}
        activeScreen={screen}
        saving={saving}
        selectedDroneId={selectedDroneId}
        hasRamWrites={hasRamWrites}
        screenEnabled={screenEnable === undefined ? null : screenEnable === 1}
        clipboard={clipboard}
        videoFormat={videoFormat}
        onToggleElement={toggleElement}
        onScreenChange={onScreenChange}
        onLoadPreset={loadPreset}
        onCopyScreen={() => { onCopy(elements.map((el) => ({ ...el }))); toast(`Screen ${screen} copied`, "info"); }}
        onPasteScreen={pasteScreen}
        onFormatChange={onFormatChange}
        onSave={handleSave}
        onCommitFlash={handleFlash}
        onReset={handleReset}
      />
      {noOsdParams ? (
        <div className="flex-1 flex items-center justify-center p-8 text-xs text-text-tertiary">
          The flight controller reports no OSD{screen} element parameters. Set OSD_TYPE and reboot, or use a build with OSD support.
        </div>
      ) : (
        <OsdScreenPreview
          enabledElements={elements.filter((el) => el.enabled)}
          activeScreen={screen}
          videoFormat={videoFormat}
          selectedDroneId={selectedDroneId}
          livePreview={livePreview}
          showGrid={showGrid}
          liveTelemetry={liveTelemetry}
          onShowGridChange={setShowGrid}
          onLivePreviewChange={setLivePreview}
          onElementMove={handleElementMove}
        />
      )}
    </div>
  );
}

export function OsdEditorPanel() {
  const [activeScreen, setActiveScreen] = useState(1);
  const [videoFormat, setVideoFormat] = useState<VideoFormat>("PAL");
  const [clipboard, setClipboard] = useState<OsdElement[] | null>(null);

  return (
    <ArmedLockOverlay>
      <ScreenEditor
        key={activeScreen}
        screen={activeScreen}
        onScreenChange={setActiveScreen}
        videoFormat={videoFormat}
        onFormatChange={setVideoFormat}
        clipboard={clipboard}
        onCopy={setClipboard}
      />
    </ArmedLockOverlay>
  );
}
