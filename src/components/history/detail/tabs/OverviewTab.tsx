"use client";

/**
 * Overview tab — Flight Info + Metrics cards.
 *
 * @license GPL-3.0-only
 */

import { Card } from "@/components/ui/card";
import { DataValue } from "@/components/ui/data-value";
import { formatDate, formatDuration, formatTime } from "@/lib/utils";
import type { FlightRecord } from "@/lib/types";

interface OverviewTabProps {
  record: FlightRecord;
}

function fmtCoord(lat?: number, lon?: number): string {
  if (lat === undefined || lon === undefined) return "—";
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

export function OverviewTab({ record }: OverviewTabProps) {
  const start = record.startTime ?? record.date;
  return (
    <div className="flex flex-col gap-3">
      <Card title="Flight Info" padding={true}>
        <div className="flex flex-col gap-2">
          <Row label="Drone" value={record.droneName} />
          {record.customName && <Row label="Name" value={record.customName} />}
          <Row label="Date" value={formatDate(start)} />
          <Row label="Start" value={formatTime(start)} />
          {record.endTime !== start && <Row label="End" value={formatTime(record.endTime)} />}
          {record.suiteType && <Row label="Suite" value={record.suiteType.toUpperCase()} />}
          <Row label="Takeoff" value={fmtCoord(record.takeoffLat, record.takeoffLon)} mono />
          <Row label="Landing" value={fmtCoord(record.landingLat, record.landingLon)} mono />
        </div>
      </Card>

      <Card title="Metrics" padding={true}>
        <div className="grid grid-cols-2 gap-3">
          <DataValue label="Duration" value={formatDuration(record.duration)} />
          <DataValue label="Distance" value={(record.distance / 1000).toFixed(2)} unit="km" />
          <DataValue label="Max Altitude" value={record.maxAlt} unit="m" />
          <DataValue label="Max Speed" value={record.maxSpeed} unit="m/s" />
          {record.avgSpeed !== undefined && (
            <DataValue label="Avg Speed" value={record.avgSpeed} unit="m/s" />
          )}
          <DataValue label="Waypoints" value={record.waypointCount} />
          <DataValue label="Battery Used" value={record.batteryUsed} unit="%" />
          {record.batteryStartV !== undefined && (
            <DataValue label="Batt Start" value={record.batteryStartV.toFixed(2)} unit="V" />
          )}
          {record.batteryEndV !== undefined && (
            <DataValue label="Batt End" value={record.batteryEndV.toFixed(2)} unit="V" />
          )}
        </div>
      </Card>
    </div>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px] text-text-secondary">{label}</span>
      <span className={`text-xs text-text-primary ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}
