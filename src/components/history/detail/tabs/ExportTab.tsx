"use client";

/**
 * Export tab — download the flight as CSV / KML / KMZ / GPX / JSON.
 *
 * CSV / KML / KMZ require a matched telemetry recording (existing infra).
 * GPX uses the FlightRecord's downsampled `path`.
 * JSON dumps the FlightRecord itself.
 * PDF placeholder defers to Phase 7 compliance export wizard.
 *
 * @license GPL-3.0-only
 */

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, FileText, Globe, FileCode, FileJson, FileType } from "lucide-react";
import {
  downloadTelemetryCSV,
  downloadTelemetryKML,
  downloadTelemetryKMZ,
} from "@/lib/telemetry-export";
import { downloadGpx } from "@/lib/formats/gpx-exporter";
import type { FlightRecord } from "@/lib/types";
import type { TelemetryRecording } from "@/lib/telemetry-recorder";

interface ExportTabProps {
  record: FlightRecord;
  matchedRecording: TelemetryRecording | undefined;
}

export function ExportTab({ record, matchedRecording }: ExportTabProps) {
  const [busy, setBusy] = useState<string | null>(null);

  const fileBase = (record.customName || `${record.droneName}-${new Date(record.startTime ?? record.date).toISOString().slice(0, 10)}`)
    .replace(/[^a-z0-9-_]+/gi, "-")
    .toLowerCase();

  const handleTelemetry = async (format: "csv" | "kml" | "kmz") => {
    if (!matchedRecording) return;
    setBusy(format);
    try {
      if (format === "csv") await downloadTelemetryCSV(matchedRecording);
      else if (format === "kml") await downloadTelemetryKML(matchedRecording);
      else await downloadTelemetryKMZ(matchedRecording);
    } finally {
      setBusy(null);
    }
  };

  const handleGpx = () => {
    if (!record.path || record.path.length === 0) return;
    downloadGpx(`${fileBase}.gpx`, {
      name: record.customName || `${record.droneName} flight`,
      description: `Duration ${record.duration}s · ${(record.distance / 1000).toFixed(2)} km · max alt ${record.maxAlt} m`,
      points: record.path.map(([lat, lon]) => ({ lat, lon })),
    });
  };

  const handleJson = () => {
    const blob = new Blob([JSON.stringify(record, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileBase}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-3">
      <Card title="Telemetry" padding={true}>
        {matchedRecording ? (
          <div className="flex flex-col gap-2">
            <p className="text-[10px] text-text-secondary">
              {matchedRecording.frameCount.toLocaleString()} frames · {matchedRecording.channels.length} channels
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                icon={<FileText size={12} />}
                disabled={busy !== null}
                onClick={() => handleTelemetry("csv")}
              >
                {busy === "csv" ? "…" : "CSV"}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                icon={<Globe size={12} />}
                disabled={busy !== null}
                onClick={() => handleTelemetry("kml")}
              >
                {busy === "kml" ? "…" : "KML"}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                icon={<Download size={12} />}
                disabled={busy !== null}
                onClick={() => handleTelemetry("kmz")}
              >
                {busy === "kmz" ? "…" : "KMZ"}
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-[10px] text-text-tertiary">
            No telemetry recording attached. Connect and arm a drone to start recording.
          </p>
        )}
      </Card>

      <Card title="Track" padding={true}>
        {record.path && record.path.length > 0 ? (
          <div className="flex flex-col gap-2">
            <p className="text-[10px] text-text-secondary">
              {record.path.length} track points
            </p>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                icon={<FileCode size={12} />}
                onClick={handleGpx}
              >
                GPX
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-[10px] text-text-tertiary">No path data on this flight.</p>
        )}
      </Card>

      <Card title="Record" padding={true}>
        <div className="flex flex-col gap-2">
          <p className="text-[10px] text-text-secondary">
            Full FlightRecord including stats, path, and metadata.
          </p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon={<FileJson size={12} />}
              onClick={handleJson}
            >
              JSON
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={<FileType size={12} />}
              disabled
              title="Coming in Phase 7 — multi-jurisdiction compliance export"
            >
              PDF
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
