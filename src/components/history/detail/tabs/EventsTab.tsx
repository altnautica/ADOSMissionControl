"use client";

/**
 * Events tab — timeline of auto-detected flight events from the analyzer.
 *
 * @license GPL-3.0-only
 */

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Play } from "lucide-react";
import type { FlightRecord, FlightEvent } from "@/lib/types";
import { useReanalysis } from "./use-reanalysis";

interface EventsTabProps {
  record: FlightRecord;
}

const severityVariant: Record<FlightEvent["severity"], "success" | "warning" | "error" | "neutral"> = {
  info: "neutral",
  warning: "warning",
  error: "error",
};

function fmtOffset(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export function EventsTab({ record }: EventsTabProps) {
  const reanalysis = useReanalysis(record);
  const events = record.events ?? [];

  if (events.length === 0) {
    return (
      <Card title="Events" padding={true}>
        <p className="text-[10px] text-text-tertiary mb-2">
          No events for this flight.
        </p>
        {record.recordingId && (
          <Button
            variant="secondary"
            size="sm"
            icon={<Play size={12} />}
            onClick={reanalysis.run}
            disabled={reanalysis.running || reanalysis.recordingMissing}
          >
            {reanalysis.running ? "Analyzing…" : "Run analysis"}
          </Button>
        )}
        {reanalysis.recordingMissing && (
          <p className="text-[10px] text-text-tertiary mt-2">
            The telemetry recording for this flight is no longer stored, so it cannot be analyzed.
          </p>
        )}
      </Card>
    );
  }

  return (
    <Card title="Events" padding={true}>
      <ul className="flex flex-col divide-y divide-border-default">
        {events
          .slice()
          .sort((a, b) => a.t - b.t)
          .map((e, i) => (
            <li key={`${e.type}-${i}`} className="flex items-center gap-3 py-1.5">
              <span className="font-mono text-[10px] text-text-tertiary tabular-nums w-12 shrink-0">
                {fmtOffset(e.t)}
              </span>
              <Badge variant={severityVariant[e.severity]} size="sm">
                {e.severity}
              </Badge>
              <span className="text-xs text-text-primary truncate">{e.label}</span>
            </li>
          ))}
      </ul>
    </Card>
  );
}
