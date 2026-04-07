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
import { Badge } from "@/components/ui/badge";
import { Download, FileText, Globe, FileCode, FileJson, FileType, AlertTriangle } from "lucide-react";
import {
  downloadTelemetryCSV,
  downloadTelemetryKML,
  downloadTelemetryKMZ,
} from "@/lib/telemetry-export";
import { downloadGpx } from "@/lib/formats/gpx-exporter";
import { exportFlights, downloadBlob } from "@/lib/compliance/exporter";
import { validateForJurisdiction, type ValidationIssue } from "@/lib/compliance/validator";
import { useOperatorProfileStore } from "@/stores/operator-profile-store";
import { useAircraftRegistryStore } from "@/stores/aircraft-registry-store";
import type { FlightRecord } from "@/lib/types";
import type { TelemetryRecording } from "@/lib/telemetry-recorder";

interface ExportTabProps {
  record: FlightRecord;
  matchedRecording: TelemetryRecording | undefined;
}

function fileBaseFor(record: FlightRecord): string {
  return (record.customName || `${record.droneName}-${new Date(record.startTime ?? record.date).toISOString().slice(0, 10)}`)
    .replace(/[^a-z0-9-_]+/gi, "-")
    .toLowerCase();
}

export function ExportTab({ record, matchedRecording }: ExportTabProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const operator = useOperatorProfileStore((s) => s.profile);
  const aircraftIndex = useAircraftRegistryStore((s) => s.aircraft);
  const aircraft = aircraftIndex[record.droneId];

  // Run the DGCA validator on every render — cheap and instantly responsive.
  const dgcaIssues: ValidationIssue[] = validateForJurisdiction(record, operator, aircraft, "IN_DGCA");
  const dgcaErrors = dgcaIssues.filter((i) => i.severity === "error");
  const dgcaWarnings = dgcaIssues.filter((i) => i.severity === "warning");

  const handleDgcaPdf = async () => {
    setBusy("dgca-pdf");
    try {
      const blob = await exportFlights({
        records: [record],
        jurisdiction: "IN_DGCA",
        format: "pdf",
        operator,
        aircraftIndex,
      });
      downloadBlob(blob, `${fileBaseFor(record)}-dgca.pdf`);
    } catch (err) {
      console.error("[ExportTab] DGCA PDF failed", err);
      if (typeof window !== "undefined") window.alert(`PDF export failed: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const fileBase = fileBaseFor(record);

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
          </div>
        </div>
      </Card>

      <Card title="Compliance · DGCA India" padding={true}>
        <div className="flex flex-col gap-2">
          <p className="text-[10px] text-text-secondary">
            Drone Rules 2021 audit-ready PDF. More jurisdictions arrive in Phase 7c.
          </p>
          <div className="flex items-center gap-2">
            <Badge variant={dgcaErrors.length > 0 ? "error" : dgcaWarnings.length > 0 ? "warning" : "success"} size="sm">
              {dgcaErrors.length > 0
                ? `${dgcaErrors.length} error${dgcaErrors.length === 1 ? "" : "s"}`
                : dgcaWarnings.length > 0
                  ? `${dgcaWarnings.length} warning${dgcaWarnings.length === 1 ? "" : "s"}`
                  : "Ready"}
            </Badge>
          </div>
          {dgcaIssues.length > 0 && (
            <ul className="flex flex-col gap-1 max-h-32 overflow-y-auto border border-border-default rounded p-2">
              {dgcaIssues.map((issue) => (
                <li key={issue.field} className="flex items-start gap-1.5 text-[10px]">
                  <AlertTriangle
                    size={10}
                    className={issue.severity === "error" ? "text-status-error mt-0.5" : "text-status-warning mt-0.5"}
                  />
                  <span className="text-text-secondary">{issue.message}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <Button
              variant="primary"
              size="sm"
              icon={<FileType size={12} />}
              disabled={busy !== null}
              onClick={handleDgcaPdf}
            >
              {busy === "dgca-pdf" ? "Generating…" : "DGCA PDF"}
            </Button>
          </div>
          <p className="text-[9px] text-text-tertiary italic">
            Errors are missing required fields per the regulator. Generate the PDF anyway to
            inspect the layout, or fix them in Settings → Operator &amp; Aircraft.
          </p>
        </div>
      </Card>
    </div>
  );
}
