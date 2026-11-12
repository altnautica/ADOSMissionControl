"use client";

/**
 * Custom Chart Builder — pick any channel + field from a recorded flight,
 * render via uPlot for 1M+ point capability with zoom/pan. The
 * channel + field registry, the data extractor, the trace picker,
 * and the uPlot wrapper live under `./custom-chart/`.
 *
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, RotateCcw, X } from "lucide-react";
import type { TelemetryFrame } from "@/lib/telemetry-recorder";
import { CHANNEL_REGISTRY } from "./custom-chart/channel-registry";
import { TracePicker } from "./custom-chart/TracePicker";
import { UPlotChart } from "./custom-chart/UPlotChart";
import { PALETTE, type TraceConfig } from "./custom-chart/types";

export interface CustomChartBuilderProps {
  frames: TelemetryFrame[];
}

export function CustomChartBuilder({ frames }: CustomChartBuilderProps) {
  const tq = useTranslations("history.customChartBuilder");
  const [traces, setTraces] = useState<TraceConfig[]>([]);
  const [adding, setAdding] = useState(false);

  // Available channels — only channels present in the actual frames.
  const availableChannels = useMemo(() => {
    const channelsInFrames = new Set(frames.map((f) => f.channel));
    return CHANNEL_REGISTRY.filter((c) => channelsInFrames.has(c.channel));
  }, [frames]);

  const addTrace = useCallback(
    (channel: string, field: string) => {
      const color = PALETTE[traces.length % PALETTE.length];
      setTraces((prev) => [
        ...prev,
        { id: `${channel}.${field}.${Date.now()}`, channel, field, color },
      ]);
      setAdding(false);
    },
    [traces.length],
  );

  const removeTrace = useCallback((id: string) => {
    setTraces((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    setTraces([]);
  }, []);

  if (traces.length === 0 && !adding) {
    return (
      <Card title={tq("customChart")} padding={true}>
        <div className="flex flex-col items-center gap-2 py-4">
          <p className="text-[10px] text-text-tertiary">
            {tq("buildACustomChartFrom")}
          </p>
          <Button variant="secondary" size="sm" onClick={() => setAdding(true)} icon={<Plus size={12} />}>
            {tq("addTrace")}
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card title={tq("customChart")} padding={true}>
      {/* Trace legend + controls */}
      <div className="flex flex-wrap items-center gap-2 mb-2">
        {traces.map((tr) => {
          const chanDef = CHANNEL_REGISTRY.find((c) => c.channel === tr.channel);
          const fieldDef = chanDef?.fields.find((f) => f.key === tr.field);
          return (
            <span
              key={tr.id}
              className="inline-flex items-center gap-1 text-[10px] font-mono bg-bg-tertiary rounded px-1.5 py-0.5"
            >
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: tr.color }} />
              {chanDef?.label ?? tr.channel} · {fieldDef?.label ?? tr.field}
              {fieldDef?.unit && <span className="text-text-tertiary">({fieldDef.unit})</span>}
              <button onClick={() => removeTrace(tr.id)} className="ml-0.5 text-text-tertiary hover:text-text-primary">
                <X size={10} />
              </button>
            </span>
          );
        })}
        <Button variant="ghost" size="sm" onClick={() => setAdding(true)} icon={<Plus size={12} />}>
          {tq("add")}
        </Button>
        {traces.length > 0 && (
          <Button variant="ghost" size="sm" onClick={clearAll} icon={<RotateCcw size={12} />}>
            {tq("clear")}
          </Button>
        )}
      </div>

      {/* Add trace picker */}
      {adding && (
        <TracePicker
          channels={availableChannels}
          onPick={addTrace}
          onCancel={() => setAdding(false)}
        />
      )}

      {/* uPlot chart */}
      {traces.length > 0 && <UPlotChart frames={frames} traces={traces} />}
    </Card>
  );
}
