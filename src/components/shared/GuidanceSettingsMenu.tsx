"use client";

import { useState, useMemo } from "react";
import { useSettingsStore } from "@/stores/settings-store";
import { ChevronDown } from "lucide-react";

interface LineConfig {
  label: string;
  setLength: (v: number) => void;
  setWidth: (v: number) => void;
  setLineType: (v: "solid" | "dashed" | "dotted") => void;
  setColor: (v: string) => void;
  length: number;
  width: number;
  lineType: "solid" | "dashed" | "dotted";
  color: string;
}

export function GuidanceSettingsMenu() {
  const [expanded, setExpanded] = useState(false);

  const guidanceHdgLength = useSettingsStore((s) => s.guidanceHdgLength);
  const guidanceHdgWidth = useSettingsStore((s) => s.guidanceHdgWidth);
  const guidanceHdgLineType = useSettingsStore((s) => s.guidanceHdgLineType);
  const guidanceHdgColor = useSettingsStore((s) => s.guidanceHdgColor);

  const guidanceTrackWpLength = useSettingsStore((s) => s.guidanceTrackWpLength);
  const guidanceTrackWpWidth = useSettingsStore((s) => s.guidanceTrackWpWidth);
  const guidanceTrackWpLineType = useSettingsStore((s) => s.guidanceTrackWpLineType);
  const guidanceTrackWpColor = useSettingsStore((s) => s.guidanceTrackWpColor);

  const guidanceTgtHdgLength = useSettingsStore((s) => s.guidanceTgtHdgLength);
  const guidanceTgtHdgWidth = useSettingsStore((s) => s.guidanceTgtHdgWidth);
  const guidanceTgtHdgLineType = useSettingsStore((s) => s.guidanceTgtHdgLineType);
  const guidanceTgtHdgColor = useSettingsStore((s) => s.guidanceTgtHdgColor);

  const setGuidanceHdgLength = useSettingsStore((s) => s.setGuidanceHdgLength);
  const setGuidanceHdgWidth = useSettingsStore((s) => s.setGuidanceHdgWidth);
  const setGuidanceHdgLineType = useSettingsStore((s) => s.setGuidanceHdgLineType);
  const setGuidanceHdgColor = useSettingsStore((s) => s.setGuidanceHdgColor);

  const setGuidanceTrackWpLength = useSettingsStore((s) => s.setGuidanceTrackWpLength);
  const setGuidanceTrackWpWidth = useSettingsStore((s) => s.setGuidanceTrackWpWidth);
  const setGuidanceTrackWpLineType = useSettingsStore((s) => s.setGuidanceTrackWpLineType);
  const setGuidanceTrackWpColor = useSettingsStore((s) => s.setGuidanceTrackWpColor);

  const setGuidanceTgtHdgLength = useSettingsStore((s) => s.setGuidanceTgtHdgLength);
  const setGuidanceTgtHdgWidth = useSettingsStore((s) => s.setGuidanceTgtHdgWidth);
  const setGuidanceTgtHdgLineType = useSettingsStore((s) => s.setGuidanceTgtHdgLineType);
  const setGuidanceTgtHdgColor = useSettingsStore((s) => s.setGuidanceTgtHdgColor);

  const lineConfigs: LineConfig[] = [
    {
      label: "HDG",
      setLength: setGuidanceHdgLength,
      setWidth: setGuidanceHdgWidth,
      setLineType: setGuidanceHdgLineType,
      setColor: setGuidanceHdgColor,
      length: guidanceHdgLength,
      width: guidanceHdgWidth,
      lineType: guidanceHdgLineType,
      color: guidanceHdgColor,
    },
    {
      label: "Track-WP",
      setLength: setGuidanceTrackWpLength,
      setWidth: setGuidanceTrackWpWidth,
      setLineType: setGuidanceTrackWpLineType,
      setColor: setGuidanceTrackWpColor,
      length: guidanceTrackWpLength,
      width: guidanceTrackWpWidth,
      lineType: guidanceTrackWpLineType,
      color: guidanceTrackWpColor,
    },
    {
      label: "TGT HDG",
      setLength: setGuidanceTgtHdgLength,
      setWidth: setGuidanceTgtHdgWidth,
      setLineType: setGuidanceTgtHdgLineType,
      setColor: setGuidanceTgtHdgColor,
      length: guidanceTgtHdgLength,
      width: guidanceTgtHdgWidth,
      lineType: guidanceTgtHdgLineType,
      color: guidanceTgtHdgColor,
    },
  ];

  return (
    <div className="absolute top-16 left-3 z-[1000] bg-bg-primary/80 backdrop-blur-md border border-border-strong rounded shadow-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between gap-3 px-3 py-2 hover:bg-bg-secondary/50 transition-colors cursor-pointer"
      >
        {expanded ? (
          <span className="text-[10px] font-mono font-semibold text-text-primary">GUIDANCE SETTINGS</span>
        ) : (
          <div className="flex items-center gap-1.5 text-[9px] font-mono text-text-secondary">
            <span className="inline-block w-3 h-px" style={{ backgroundColor: guidanceHdgColor }} />
            <span>HDG</span>
            <span className="inline-block w-3 h-px border-t border-dashed" style={{ borderTopColor: guidanceTrackWpColor }} />
            <span>Track-WP</span>
            <span className="inline-block w-3 h-px border-t border-dashed" style={{ borderTopColor: guidanceTgtHdgColor }} />
            <span>TGT HDG</span>
          </div>
        )}
        <ChevronDown
          size={12}
          className={`text-text-secondary transition-transform shrink-0 ${expanded ? "rotate-180" : ""}`}
        />
      </button>

      {expanded && (
        <div className="border-t border-border-default px-3 py-2 space-y-3 max-h-96 overflow-y-auto bg-bg-secondary/20">
          {lineConfigs.map((config) => (
            <LineSettings key={config.label} {...config} />
          ))}
        </div>
      )}
    </div>
  );
}

function LineSettings(config: LineConfig) {
  const previewStyle = useMemo(() => {
    const style = config.lineType === "solid" ? "solid" : config.lineType === "dashed" ? "dashed" : "dotted";
    return {
      borderTopWidth: "2px",
      borderTopStyle: style as "solid" | "dashed" | "dotted",
      borderTopColor: config.color,
    };
  }, [config.lineType, config.color]);

  return (
    <div className="pb-3 border-b border-border-default/50 last:border-b-0 last:pb-0">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-mono font-semibold text-text-primary">{config.label}</span>
        <div className="inline-block w-8 h-px" style={previewStyle} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[8px] text-text-secondary font-mono uppercase block mb-1">
            Length (m)
          </label>
          <input
            type="number"
            min="20"
            max="300"
            step="10"
            value={config.length}
            onChange={(e) => config.setLength(Number(e.target.value))}
            className="w-full px-2 py-1 text-[10px] font-mono bg-bg-primary border border-border-default rounded text-text-primary focus:outline-none focus:border-accent-primary"
          />
        </div>

        <div>
          <label className="text-[8px] text-text-secondary font-mono uppercase block mb-1">
            Width (px)
          </label>
          <input
            type="number"
            min="0.5"
            max="5"
            step="0.5"
            value={config.width}
            onChange={(e) => config.setWidth(Number(e.target.value))}
            className="w-full px-2 py-1 text-[10px] font-mono bg-bg-primary border border-border-default rounded text-text-primary focus:outline-none focus:border-accent-primary"
          />
        </div>

        <div className="col-span-2">
          <label className="text-[8px] text-text-secondary font-mono uppercase block mb-1">
            Line Type
          </label>
          <select
            value={config.lineType}
            onChange={(e) => config.setLineType(e.target.value as "solid" | "dashed" | "dotted")}
            className="w-full px-2 py-1 text-[10px] font-mono bg-bg-primary border border-border-default rounded text-text-primary focus:outline-none focus:border-accent-primary"
          >
            <option value="solid">Solid</option>
            <option value="dashed">Dashed</option>
            <option value="dotted">Dotted</option>
          </select>
        </div>

        <div className="col-span-2">
          <label className="text-[8px] text-text-secondary font-mono uppercase block mb-1">
            Color
          </label>
          <div className="flex gap-2">
            <input
              type="color"
              value={config.color}
              onChange={(e) => config.setColor(e.target.value)}
              className="w-10 h-8 rounded cursor-pointer border border-border-default"
            />
            <input
              type="text"
              value={config.color}
              onChange={(e) => config.setColor(e.target.value)}
              className="flex-1 px-2 py-1 text-[10px] font-mono bg-bg-primary border border-border-default rounded text-text-primary focus:outline-none focus:border-accent-primary"
              placeholder="#000000"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
