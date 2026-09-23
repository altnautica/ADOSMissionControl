"use client";

/**
 * Analysis tab — auto-detected anomaly flags + health summary.
 *
 * @license GPL-3.0-only
 */

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataValue } from "@/components/ui/data-value";
import { Play } from "lucide-react";
import type { FlightRecord, FlightFlag } from "@/lib/types";
import { useReanalysis } from "./use-reanalysis";

interface AnalysisTabProps {
  record: FlightRecord;
}

const severityVariant: Record<FlightFlag["severity"], "success" | "warning" | "error" | "neutral"> = {
  info: "neutral",
  warning: "warning",
  error: "error",
};

export function AnalysisTab({ record }: AnalysisTabProps) {
  const reanalysis = useReanalysis(record);
  const flags = record.flags ?? [];
  const health = record.health ?? {};

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
        <>
          <Button
            variant="ghost"
            size="sm"
            icon={<Play size={12} />}
            onClick={reanalysis.run}
            disabled={reanalysis.running || reanalysis.recordingMissing}
          >
            {reanalysis.running ? "Analyzing…" : "Re-run analysis"}
          </Button>
          {reanalysis.recordingMissing && (
            <p className="text-[10px] text-text-tertiary">
              The telemetry recording for this flight is no longer stored, so it cannot be re-analyzed.
            </p>
          )}
        </>
      )}
    </div>
  );
}
