"use client";

import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { DataValue } from "@/components/ui/data-value";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate, formatDuration, formatTime } from "@/lib/utils";
import type { FlightRecord } from "@/lib/types";
import type { TelemetryRecording } from "@/lib/telemetry-recorder";
import { listRecordings } from "@/lib/telemetry-recorder";
import {
  downloadTelemetryCSV,
  downloadTelemetryKML,
  downloadTelemetryKMZ,
} from "@/lib/telemetry-export";
import { X, Download, FileText, Globe, Play } from "lucide-react";

const statusVariant: Record<string, "success" | "warning" | "error"> = {
  completed: "success",
  aborted: "warning",
  emergency: "error",
};

interface HistoryDetailPanelProps {
  record: FlightRecord;
  onClose: () => void;
  onReplay?: (recording: TelemetryRecording) => void;
}

export function HistoryDetailPanel({ record, onClose, onReplay }: HistoryDetailPanelProps) {
  const [recordings, setRecordings] = useState<TelemetryRecording[]>([]);
  const [exporting, setExporting] = useState<string | null>(null);

  useEffect(() => {
    listRecordings().then(setRecordings);
  }, []);

  // Find a recording that matches this flight record by drone ID and time overlap
  const matchedRecording = recordings.find((rec) => {
    if (rec.droneId && rec.droneId === record.droneId) return true;
    // Fuzzy match by time: recording started within 60s of flight record
    const timeDiff = Math.abs(rec.startTime - record.date);
    return timeDiff < 60_000;
  });

  const handleExport = async (
    format: "csv" | "kml" | "kmz",
    rec: TelemetryRecording,
  ) => {
    setExporting(format);
    try {
      if (format === "csv") await downloadTelemetryCSV(rec);
      else if (format === "kml") await downloadTelemetryKML(rec);
      else await downloadTelemetryKMZ(rec);
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="w-[340px] border-l border-border-default bg-bg-secondary flex flex-col shrink-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-default flex-shrink-0">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold text-text-primary uppercase tracking-wider">
            Flight Detail
          </h3>
          <Badge variant={statusVariant[record.status] ?? "neutral"} size="sm">
            {record.status}
          </Badge>
        </div>
        <button
          onClick={onClose}
          className="text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
        >
          <X size={14} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto flex flex-col gap-3 p-3">
        {/* Flight Info */}
        <Card title="Flight Info" padding={true}>
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-text-secondary">Drone</span>
              <span className="text-xs font-mono text-text-primary">{record.droneName}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-text-secondary">Date</span>
              <span className="text-xs font-mono text-text-primary">{formatDate(record.date)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-text-secondary">Time</span>
              <span className="text-xs font-mono text-text-primary">{formatTime(record.date)}</span>
            </div>
            {record.suiteType && (
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-text-secondary">Suite</span>
                <span className="text-xs font-mono text-text-primary uppercase">{record.suiteType}</span>
              </div>
            )}
          </div>
        </Card>

        {/* Metrics */}
        <Card title="Metrics" padding={true}>
          <div className="grid grid-cols-2 gap-3">
            <DataValue label="Duration" value={formatDuration(record.duration)} />
            <DataValue label="Distance" value={(record.distance / 1000).toFixed(1)} unit="km" />
            <DataValue label="Max Altitude" value={record.maxAlt} unit="m" />
            <DataValue label="Max Speed" value={record.maxSpeed} unit="m/s" />
            <DataValue label="Waypoints" value={record.waypointCount} />
            <DataValue label="Battery Used" value={record.batteryUsed} unit="%" />
          </div>
        </Card>

        {/* Replay Flight */}
        {matchedRecording && matchedRecording.channels.includes("position") && onReplay ? (
          <Card title="Flight Replay" padding={true}>
            <div className="flex flex-col gap-2">
              <p className="text-[10px] text-text-secondary">
                Replay this flight on the map with full telemetry.
              </p>
              <Button
                variant="primary"
                size="sm"
                icon={<Play size={12} />}
                onClick={() => onReplay(matchedRecording)}
              >
                Replay Flight
              </Button>
            </div>
          </Card>
        ) : (
          <Card title="Route" padding={true}>
            <div className="flex items-center justify-center h-[80px] bg-bg-tertiary border border-border-default">
              <span className="text-[10px] text-text-tertiary font-mono">
                {matchedRecording ? "No position data in recording" : "No recording for this flight"}
              </span>
            </div>
          </Card>
        )}

        {/* Telemetry Export */}
        <Card title="Export Telemetry" padding={true}>
          {matchedRecording ? (
            <div className="flex flex-col gap-2">
              <p className="text-[10px] text-text-secondary">
                {matchedRecording.frameCount.toLocaleString()} frames recorded
                ({matchedRecording.channels.length} channels)
              </p>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<FileText size={12} />}
                  disabled={exporting !== null}
                  onClick={() => handleExport("csv", matchedRecording)}
                >
                  {exporting === "csv" ? "..." : "CSV"}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Globe size={12} />}
                  disabled={exporting !== null}
                  onClick={() => handleExport("kml", matchedRecording)}
                >
                  {exporting === "kml" ? "..." : "KML"}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Download size={12} />}
                  disabled={exporting !== null}
                  onClick={() => handleExport("kmz", matchedRecording)}
                >
                  {exporting === "kmz" ? "..." : "KMZ"}
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-[10px] text-text-tertiary">
              No telemetry recording found for this flight.
              Start recording before your next flight to enable export.
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
