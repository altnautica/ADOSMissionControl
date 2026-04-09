"use client";

import { MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTelemetryStore } from "@/stores/telemetry-store";

interface GpsCardProps {
  className?: string;
}

const FIX_LABELS: Record<number, { label: string; color: string }> = {
  0: { label: "No Fix", color: "bg-red-500/80 text-white" },
  1: { label: "No Fix", color: "bg-red-500/80 text-white" },
  2: { label: "2D Fix", color: "bg-yellow-500/80 text-black" },
  3: { label: "3D Fix", color: "bg-green-500/80 text-white" },
  4: { label: "DGPS", color: "bg-green-600/80 text-white" },
  5: { label: "RTK Float", color: "bg-blue-400/80 text-white" },
  6: { label: "RTK Fix", color: "bg-blue-500/80 text-white" },
};

export function GpsCard({ className }: GpsCardProps) {
  useTelemetryStore((s) => s._version);
  const gps = useTelemetryStore((s) => s.gps);
  const position = useTelemetryStore((s) => s.position);
  const gpsLatest = gps.latest();
  const posLatest = position.latest();

  const fix = FIX_LABELS[gpsLatest?.fixType ?? 0] ?? FIX_LABELS[0];
  // DEC-108: HDOP is uninitialized garbage (often ~655) when there's no
  // GPS lock. Only show the HDOP value when fix type is 2D or better.
  const hasFix = (gpsLatest?.fixType ?? 0) >= 2;

  return (
    <div
      className={cn(
        "border border-border-default rounded-lg p-4",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <MapPin className="w-3.5 h-3.5 text-text-tertiary" />
          <span className="text-xs font-medium text-text-secondary">GPS</span>
        </div>
        <span
          className={cn(
            "text-[10px] font-medium px-1.5 py-0.5 rounded",
            fix.color
          )}
        >
          {fix.label}
        </span>
      </div>

      {/* Sats + HDOP */}
      <div className="flex items-center gap-3 mb-1.5">
        <div className="text-[10px] text-text-tertiary">
          Sats{" "}
          <span className="text-text-primary font-mono">
            {gpsLatest?.satellites ?? "--"}
          </span>
        </div>
        <div className="text-[10px] text-text-tertiary">
          HDOP{" "}
          <span className="text-text-primary font-mono">
            {hasFix ? gpsLatest!.hdop.toFixed(1) : "--.-"}
          </span>
        </div>
      </div>

      {/* Lat/Lon */}
      <div className="space-y-0.5 mb-1.5">
        <div className="flex justify-between">
          <span className="text-[10px] text-text-tertiary">Lat</span>
          <span className="text-xs font-mono text-text-primary">
            {hasFix ? gpsLatest!.lat.toFixed(6) : "---.------"}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-[10px] text-text-tertiary">Lon</span>
          <span className="text-xs font-mono text-text-primary">
            {hasFix ? gpsLatest!.lon.toFixed(6) : "---.------"}
          </span>
        </div>
      </div>

      {/* Altitude */}
      <div className="flex gap-3 mb-1.5">
        <div className="text-[10px] text-text-tertiary">
          MSL{" "}
          <span className="text-text-primary font-mono text-xs">
            {hasFix ? `${gpsLatest!.alt.toFixed(1)}m` : "--.-m"}
          </span>
        </div>
        <div className="text-[10px] text-text-tertiary">
          Rel{" "}
          <span className="text-text-primary font-mono text-xs">
            {posLatest ? `${posLatest.relativeAlt.toFixed(1)}m` : "--.-m"}
          </span>
        </div>
      </div>

      {/* Heading + Groundspeed */}
      <div className="flex gap-3">
        <div className="text-[10px] text-text-tertiary">
          Hdg{" "}
          <span className="text-text-primary font-mono text-xs">
            {posLatest ? `${posLatest.heading.toFixed(0)}\u00B0` : "--\u00B0"}
          </span>
        </div>
        <div className="text-[10px] text-text-tertiary">
          GS{" "}
          <span className="text-text-primary font-mono text-xs">
            {posLatest
              ? `${posLatest.groundSpeed.toFixed(1)} m/s`
              : "-- m/s"}
          </span>
        </div>
      </div>

      {!gpsLatest && !posLatest && (
        <div className="text-[10px] text-text-tertiary text-center mt-1">
          Waiting for data...
        </div>
      )}
    </div>
  );
}
