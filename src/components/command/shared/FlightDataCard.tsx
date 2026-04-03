"use client";

import { Compass, Radio, Navigation } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTelemetryStore } from "@/stores/telemetry-store";

interface FlightDataCardProps {
  className?: string;
}

const FIX_LABELS: Record<number, { label: string; color: string }> = {
  0: { label: "No Fix", color: "text-status-error" },
  1: { label: "No Fix", color: "text-status-error" },
  2: { label: "2D Fix", color: "text-status-warning" },
  3: { label: "3D Fix", color: "text-status-success" },
  4: { label: "DGPS", color: "text-status-success" },
  5: { label: "RTK Float", color: "text-accent-primary" },
  6: { label: "RTK Fix", color: "text-accent-primary" },
};

function toDeg(rad: number) {
  return (rad * 180) / Math.PI;
}

function normalizeHeading(deg: number) {
  return ((deg % 360) + 360) % 360;
}

export function FlightDataCard({ className }: FlightDataCardProps) {
  useTelemetryStore((s) => s._version);
  const attitude = useTelemetryStore((s) => s.attitude);
  const position = useTelemetryStore((s) => s.position);
  const gps = useTelemetryStore((s) => s.gps);
  const radio = useTelemetryStore((s) => s.radio);

  const att = attitude.latest();
  const pos = position.latest();
  const gpsData = gps.latest();
  const radioData = radio.latest();

  const fix = FIX_LABELS[gpsData?.fixType ?? 0] ?? FIX_LABELS[0];
  const heading = pos?.heading ?? (att ? normalizeHeading(toDeg(att.yaw)) : undefined);

  const fmtDeg = (v: number | undefined) =>
    v !== undefined ? toDeg(v).toFixed(1) : "--.-";
  const fmtHdg = (v: number | undefined) =>
    v !== undefined ? v.toFixed(0).padStart(3, "0") : "---";

  return (
    <div
      className={cn(
        "border border-border-default rounded-lg bg-bg-secondary p-3",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-1.5 mb-2">
        <Compass className="w-3.5 h-3.5 text-text-tertiary" />
        <span className="text-xs font-medium text-text-secondary">
          Flight Data
        </span>
      </div>

      {/* Attitude section */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px]">
        <div className="flex justify-between">
          <span className="text-text-tertiary">Roll</span>
          <span className="font-mono text-text-primary">
            {fmtDeg(att?.roll)}&deg;
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-text-tertiary">Pitch</span>
          <span className="font-mono text-text-primary">
            {fmtDeg(att?.pitch)}&deg;
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-text-tertiary">Yaw</span>
          <span className="font-mono text-text-primary">
            {fmtDeg(att?.yaw)}&deg;
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-text-tertiary">Hdg</span>
          <span className="font-mono text-text-primary">
            {fmtHdg(heading)}&deg;
          </span>
        </div>
      </div>

      {/* GPS section */}
      <div className="border-t border-border-default mt-2 pt-2">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-1">
            <Navigation className="w-3 h-3 text-text-tertiary" />
            <span className="text-[10px] font-medium text-text-secondary">
              GPS
            </span>
          </div>
          <span className={cn("text-[10px] font-mono font-medium", fix.color)}>
            {fix.label}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px]">
          <div className="flex justify-between">
            <span className="text-text-tertiary">Sats</span>
            <span className="font-mono text-text-primary">
              {gpsData?.satellites ?? "--"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-tertiary">HDOP</span>
            <span className="font-mono text-text-primary">
              {gpsData ? gpsData.hdop.toFixed(1) : "--.-"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-tertiary">Lat</span>
            <span className="font-mono text-text-primary">
              {gpsData ? gpsData.lat.toFixed(6) : "---.------"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-tertiary">Lon</span>
            <span className="font-mono text-text-primary">
              {gpsData ? gpsData.lon.toFixed(6) : "---.------"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-tertiary">MSL</span>
            <span className="font-mono text-text-primary">
              {gpsData ? `${gpsData.alt.toFixed(1)}m` : "--.-m"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-tertiary">Rel</span>
            <span className="font-mono text-text-primary">
              {pos ? `${pos.relativeAlt.toFixed(1)}m` : "--.-m"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-tertiary">Hdg</span>
            <span className="font-mono text-text-primary">
              {pos ? `${pos.heading.toFixed(0)}\u00B0` : "--\u00B0"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-tertiary">GS</span>
            <span className="font-mono text-text-primary">
              {pos ? `${pos.groundSpeed.toFixed(1)} m/s` : "-- m/s"}
            </span>
          </div>
        </div>
      </div>

      {/* Radio section */}
      <div className="border-t border-border-default mt-2 pt-2">
        <div className="flex items-center gap-1 mb-1">
          <Radio className="w-3 h-3 text-text-tertiary" />
          <span className="text-[10px] font-medium text-text-secondary">
            Radio
          </span>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px]">
          <div className="flex justify-between">
            <span className="text-text-tertiary">RSSI</span>
            <span className="font-mono text-text-primary">
              {radioData ? `${radioData.rssi} dBm` : "-- dBm"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-tertiary">Remote</span>
            <span className="font-mono text-text-primary">
              {radioData ? `${radioData.remrssi} dBm` : "-- dBm"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-tertiary">TX</span>
            <span className="font-mono text-text-primary">
              {radioData ? `${radioData.txbuf}%` : "--%"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-tertiary">RX Err</span>
            <span className="font-mono text-text-primary">
              {radioData ? `${radioData.rxerrors}` : "--"}
            </span>
          </div>
        </div>
      </div>

      {/* No data fallback */}
      {!att && !gpsData && !radioData && (
        <div className="text-[10px] text-text-tertiary text-center mt-2">
          Waiting for telemetry...
        </div>
      )}
    </div>
  );
}
