"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useShallow } from "zustand/react/shallow";
import { useSettingsStore, type GuidanceLineType } from "@/stores/settings-store";
import { ChevronDown, RotateCcw } from "lucide-react";

interface LineConfig {
  id: string;
  label: string;
  enabled: boolean;
  setEnabled: (v: boolean) => void;
  setLength: (v: number) => void;
  setWidth: (v: number) => void;
  setLineType: (v: GuidanceLineType) => void;
  setColor: (v: string) => void;
  length: number;
  width: number;
  lineType: GuidanceLineType;
  color: string;
}

export function GuidanceSettingsMenu() {
  const [expanded, setExpanded] = useState(false);
  const t = useTranslations("guidance");

  const hdg = useSettingsStore(useShallow((s) => ({
    enabled: s.guidanceHdgEnabled, length: s.guidanceHdgLength, width: s.guidanceHdgWidth,
    lineType: s.guidanceHdgLineType, color: s.guidanceHdgColor,
  })));
  const trackWp = useSettingsStore(useShallow((s) => ({
    enabled: s.guidanceTrackWpEnabled, length: s.guidanceTrackWpLength, width: s.guidanceTrackWpWidth,
    lineType: s.guidanceTrackWpLineType, color: s.guidanceTrackWpColor,
  })));
  const tgtHdg = useSettingsStore(useShallow((s) => ({
    enabled: s.guidanceTgtHdgEnabled, length: s.guidanceTgtHdgLength, width: s.guidanceTgtHdgWidth,
    lineType: s.guidanceTgtHdgLineType, color: s.guidanceTgtHdgColor,
  })));

  const setHdgEnabled = useSettingsStore((s) => s.setGuidanceHdgEnabled);
  const setHdgLength = useSettingsStore((s) => s.setGuidanceHdgLength);
  const setHdgWidth = useSettingsStore((s) => s.setGuidanceHdgWidth);
  const setHdgLineType = useSettingsStore((s) => s.setGuidanceHdgLineType);
  const setHdgColor = useSettingsStore((s) => s.setGuidanceHdgColor);
  const setTrackWpEnabled = useSettingsStore((s) => s.setGuidanceTrackWpEnabled);
  const setTrackWpLength = useSettingsStore((s) => s.setGuidanceTrackWpLength);
  const setTrackWpWidth = useSettingsStore((s) => s.setGuidanceTrackWpWidth);
  const setTrackWpLineType = useSettingsStore((s) => s.setGuidanceTrackWpLineType);
  const setTrackWpColor = useSettingsStore((s) => s.setGuidanceTrackWpColor);
  const setTgtHdgEnabled = useSettingsStore((s) => s.setGuidanceTgtHdgEnabled);
  const setTgtHdgLength = useSettingsStore((s) => s.setGuidanceTgtHdgLength);
  const setTgtHdgWidth = useSettingsStore((s) => s.setGuidanceTgtHdgWidth);
  const setTgtHdgLineType = useSettingsStore((s) => s.setGuidanceTgtHdgLineType);
  const setTgtHdgColor = useSettingsStore((s) => s.setGuidanceTgtHdgColor);
  const resetAll = useSettingsStore((s) => s.resetGuidanceDefaults);

  const lineConfigs: LineConfig[] = useMemo(() => [
    {
      id: "hdg", label: t("hdg"), enabled: hdg.enabled, setEnabled: setHdgEnabled,
      setLength: setHdgLength, setWidth: setHdgWidth, setLineType: setHdgLineType, setColor: setHdgColor,
      length: hdg.length, width: hdg.width, lineType: hdg.lineType, color: hdg.color,
    },
    {
      id: "trackWp", label: t("trackWp"), enabled: trackWp.enabled, setEnabled: setTrackWpEnabled,
      setLength: setTrackWpLength, setWidth: setTrackWpWidth, setLineType: setTrackWpLineType, setColor: setTrackWpColor,
      length: trackWp.length, width: trackWp.width, lineType: trackWp.lineType, color: trackWp.color,
    },
    {
      id: "tgtHdg", label: t("tgtHdg"), enabled: tgtHdg.enabled, setEnabled: setTgtHdgEnabled,
      setLength: setTgtHdgLength, setWidth: setTgtHdgWidth, setLineType: setTgtHdgLineType, setColor: setTgtHdgColor,
      length: tgtHdg.length, width: tgtHdg.width, lineType: tgtHdg.lineType, color: tgtHdg.color,
    },
  ], [hdg, trackWp, tgtHdg, t, setHdgEnabled, setHdgLength, setHdgWidth, setHdgLineType, setHdgColor,
      setTrackWpEnabled, setTrackWpLength, setTrackWpWidth, setTrackWpLineType, setTrackWpColor,
      setTgtHdgEnabled, setTgtHdgLength, setTgtHdgWidth, setTgtHdgLineType, setTgtHdgColor]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape" && expanded) setExpanded(false);
  }, [expanded]);

  useEffect(() => {
    if (expanded) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [expanded, handleKeyDown]);

  return (
    <div className="absolute top-16 left-3 z-[1000] bg-bg-primary/80 backdrop-blur-md border border-border-strong rounded shadow-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-controls="guidance-settings-panel"
        className="w-full flex items-center justify-between gap-3 px-3 py-2 hover:bg-bg-secondary/50 transition-colors cursor-pointer"
      >
        {expanded ? (
          <span className="text-[10px] font-mono font-semibold text-text-primary">{t("title")}</span>
        ) : (
          <div className="flex items-center gap-1.5 text-[9px] font-mono text-text-secondary">
            {hdg.enabled && (
              <>
                <span className="inline-block w-3 h-px" style={{ backgroundColor: hdg.color }} />
                <span>{t("hdg")}</span>
              </>
            )}
            {trackWp.enabled && (
              <>
                <span className="inline-block w-3 h-px border-t border-dashed" style={{ borderTopColor: trackWp.color }} />
                <span>{t("trackWp")}</span>
              </>
            )}
            {tgtHdg.enabled && (
              <>
                <span className="inline-block w-3 h-px border-t border-dashed" style={{ borderTopColor: tgtHdg.color }} />
                <span>{t("tgtHdg")}</span>
              </>
            )}
            {!hdg.enabled && !trackWp.enabled && !tgtHdg.enabled && (
              <span className="text-text-tertiary">{t("allHidden")}</span>
            )}
          </div>
        )}
        <ChevronDown
          size={12}
          className={`text-text-secondary transition-transform shrink-0 ${expanded ? "rotate-180" : ""}`}
        />
      </button>

      {expanded && (
        <div
          id="guidance-settings-panel"
          role="region"
          aria-label={t("title")}
          className="border-t border-border-default px-3 py-2 space-y-3 max-h-[min(24rem,calc(100vh-8rem))] overflow-y-auto bg-bg-secondary/20"
        >
          {lineConfigs.map((config) => (
            <LineSettings key={config.id} config={config} />
          ))}
          <button
            type="button"
            onClick={resetAll}
            className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 text-[9px] font-mono text-text-tertiary hover:text-text-secondary border border-border-default/50 rounded transition-colors"
          >
            <RotateCcw size={10} />
            {t("resetAll")}
          </button>
        </div>
      )}
    </div>
  );
}

function LineSettings({ config }: { config: LineConfig }) {
  const t = useTranslations("guidance");

  const previewStyle = useMemo(() => {
    const style = config.lineType === "solid" ? "solid" : config.lineType === "dashed" ? "dashed" : "dotted";
    return {
      borderTopWidth: "2px",
      borderTopStyle: style as "solid" | "dashed" | "dotted",
      borderTopColor: config.color,
    };
  }, [config.lineType, config.color]);

  return (
    <div className={`pb-3 border-b border-border-default/50 last:border-b-0 last:pb-0 transition-opacity ${config.enabled ? "" : "opacity-40"}`}>
      <div className="flex items-center justify-between mb-2">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => config.setEnabled(e.target.checked)}
            className="w-3 h-3 rounded border-border-default accent-accent-primary cursor-pointer"
          />
          <span className="text-[10px] font-mono font-semibold text-text-primary">{config.label}</span>
        </label>
        <div className="inline-block w-8 h-px" style={previewStyle} />
      </div>

      {config.enabled && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[8px] text-text-secondary font-mono uppercase block mb-1">{t("length")}</label>
            <input type="number" min="20" max="300" step="10" value={config.length}
              onChange={(e) => config.setLength(Number(e.target.value))}
              className="w-full px-2 py-1 text-[10px] font-mono bg-bg-primary border border-border-default rounded text-text-primary focus:outline-none focus:border-accent-primary" />
          </div>
          <div>
            <label className="text-[8px] text-text-secondary font-mono uppercase block mb-1">{t("width")}</label>
            <input type="number" min="0.5" max="5" step="0.5" value={config.width}
              onChange={(e) => config.setWidth(Number(e.target.value))}
              className="w-full px-2 py-1 text-[10px] font-mono bg-bg-primary border border-border-default rounded text-text-primary focus:outline-none focus:border-accent-primary" />
          </div>
          <div className="col-span-2">
            <label className="text-[8px] text-text-secondary font-mono uppercase block mb-1">{t("lineType")}</label>
            <select value={config.lineType}
              onChange={(e) => config.setLineType(e.target.value as GuidanceLineType)}
              className="w-full px-2 py-1 text-[10px] font-mono bg-bg-primary border border-border-default rounded text-text-primary focus:outline-none focus:border-accent-primary">
              <option value="solid">{t("solid")}</option>
              <option value="dashed">{t("dashed")}</option>
              <option value="dotted">{t("dotted")}</option>
            </select>
          </div>
          <div className="col-span-2">
            <label className="text-[8px] text-text-secondary font-mono uppercase block mb-1">{t("color")}</label>
            <div className="flex gap-2">
              <input type="color" value={config.color} onChange={(e) => config.setColor(e.target.value)}
                className="w-10 h-8 rounded cursor-pointer border border-border-default" />
              <input type="text" value={config.color} onChange={(e) => config.setColor(e.target.value)}
                className="flex-1 px-2 py-1 text-[10px] font-mono bg-bg-primary border border-border-default rounded text-text-primary focus:outline-none focus:border-accent-primary"
                placeholder="#000000" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
