"use client";

import { useTelemetryLatest } from "@/hooks/use-telemetry-latest";
import { parseSensorHealth } from "@/lib/protocol/mavlink-constants";
import { cn } from "@/lib/utils";

interface SensorHealthBarProps {
  compact?: boolean;
}

/** Core sensors to always show when present. */
const CORE_SENSOR_IDS = new Set([0, 1, 2, 3, 5, 15, 16, 21]); // Gyro, Accel, Compass, Baro, GPS, Motors, RC, AHRS

export function SensorHealthBar({ compact = false }: SensorHealthBarProps) {
  const sysStatus = useTelemetryLatest("sysStatus");

  if (!sysStatus) {
    return (
      <div className={cn("flex items-center gap-1.5", compact ? "py-1" : "py-2")}>
        <span className="text-[10px] text-text-tertiary">No sensor data</span>
      </div>
    );
  }

  const sensors = parseSensorHealth(
    sysStatus.sensorsPresent,
    sysStatus.sensorsEnabled,
    sysStatus.sensorsHealthy,
  );

  const displayed = compact
    ? sensors.filter((s) => CORE_SENSOR_IDS.has(s.id))
    : sensors;

  return (
    <div className={cn("flex items-center gap-1.5 flex-wrap", compact ? "py-1" : "py-2")}>
      {displayed.map((sensor) => {
        const color = sensor.healthy
          ? "bg-status-success"
          : sensor.enabled
            ? "bg-status-warning"
            : "bg-status-error";

        return (
          <div
            key={sensor.id}
            className="flex items-center gap-1"
            title={`${sensor.name}: ${sensor.healthy ? "OK" : sensor.enabled ? "Unhealthy" : "Disabled"}`}
          >
            <span className={cn("w-1.5 h-1.5 rounded-full", color)} />
            <span className={cn(
              "font-mono",
              compact ? "text-[9px]" : "text-[10px]",
              sensor.healthy ? "text-text-secondary" : "text-status-warning"
            )}>
              {sensor.shortName}
            </span>
          </div>
        );
      })}
    </div>
  );
}
