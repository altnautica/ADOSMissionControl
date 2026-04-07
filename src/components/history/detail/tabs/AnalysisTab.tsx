"use client";

/**
 * Analysis tab — auto-detected anomaly flags + health summary.
 *
 * @license GPL-3.0-only
 */

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataValue } from "@/components/ui/data-value";
import { Play } from "lucide-react";
import { loadRecordingFrames } from "@/lib/telemetry-recorder";
import { analyzeFlight } from "@/lib/flight-analysis/analyzer";
import { useHistoryStore } from "@/stores/history-store";
import type { FlightRecord, FlightFlag } from "@/lib/types";

interface AnalysisTabProps {
  record: FlightRecord;
}

const severityVariant: Record<FlightFlag["severity"], "success" | "warning" | "error" | "neutral"> = {
  info: "neutral",
  warning: "warning",
  error: "error",
};

export function AnalysisTab({ record }: AnalysisTabProps) {
  const [running, setRunning] = useState(false);
  const flags = record.flags ?? [];
  const health = record.health ?? {};

  const handleRunAnalysis = async () => {
    if (!record.recordingId) return;
    setRunning(true);
    try {
      const frames = await loadRecordingFrames(record.recordingId);
      const result = analyzeFlight(frames);
      const store = useHistoryStore.getState();
      store.updateRecord(record.id, {
        events: result.events,
        flags: result.flags,
        health: result.health,
      });
      void store.persistToIDB();
    } finally {
      setRunning(false);
    }
  };

  const hasHealth = Object.values(health).some((v) => v !== undefined);

  return (
    <div className="flex flex-col gap-3">
      <Card title="Health Summary" padding={true}>
        {hasHealth ? (
          <div className="grid grid-cols-2 gap-3">
            {health.avgSatellites !== undefined && (
              <DataValue label="Avg Sats" value={health.avgSatellites} />
            )}
            {health.avgHdop !== undefined && (
              <DataValue label="Avg HDOP" value={health.avgHdop} />
            )}
            {health.maxVibrationRms !== undefined && (
              <DataValue label="Max Vib RMS" value={health.maxVibrationRms} unit="m/s²" />
            )}
            {health.batteryHealthPct !== undefined && (
              <DataValue label="Battery Used" value={health.batteryHealthPct} unit="%" />
            )}
          </div>
        ) : (
          <p className="text-[10px] text-text-tertiary">No health stats yet.</p>
        )}
      </Card>

      <Card title="Flags" padding={true}>
        {flags.length === 0 ? (
          <p className="text-[10px] text-text-tertiary">No anomaly flags. ✓</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {flags.map((f, i) => (
              <li key={`${f.type}-${i}`} className="flex flex-col gap-1 border-l-2 border-border-default pl-2">
                <div className="flex items-center gap-2">
                  <Badge variant={severityVariant[f.severity]} size="sm">
                    {f.severity}
                  </Badge>
                  <span className="text-xs text-text-primary font-mono">{f.type}</span>
                </div>
                <p className="text-[10px] text-text-secondary">{f.message}</p>
                {f.suggestion && (
                  <p className="text-[10px] text-text-tertiary italic">{f.suggestion}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {record.recordingId && (
        <Button
          variant="ghost"
          size="sm"
          icon={<Play size={12} />}
          onClick={handleRunAnalysis}
          disabled={running}
        >
          {running ? "Analyzing…" : "Re-run analysis"}
        </Button>
      )}
    </div>
  );
}
