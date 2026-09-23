"use client";

import { useFreshTelemetry } from "@/hooks/use-telemetry-latest";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { parseSensorHealth } from "@/lib/protocol/mavlink-constants";
import { cn } from "@/lib/utils";

interface SensorHealthBarProps {
  compact?: boolean;
  /**
   * False when the surface knows no FC is attached; the bar then shows no
   * sensor claims whatever the telemetry ring still holds.
   */
  fcLive?: boolean;
}

/** Core sensors to always show when present. */
const CORE_SENSOR_IDS = new Set([0, 1, 2, 3, 5, 15, 16, 21]); // Gyro, Accel, Compass, Baro, GPS, Motors, RC, AHRS

export function SensorHealthBar({ compact = false, fcLive = true }: SensorHealthBarProps) {
  // Fresh SYS_STATUS or undefined. The ring keeps its last sample when the
  // link dies, so an ungated bar kept every sensor green "OK" for as long as
  // the tab stayed open after a radio dropout.
  const fresh = useFreshTelemetry("sysStatus");
  const sysStatus = fcLive ? fresh : undefined;

  if (!sysStatus) {
    const heard = fcLive && useTelemetryStore.getState().sysStatus.latest() !== undefined;
    return (
      <div
        className={cn("flex items-center gap-1.5", compact ? "py-1" : "py-2")}
        data-testid={heard ? "sensor-health-stale" : "sensor-health-none"}
      >
        <span className={cn("text-[10px]", heard ? "text-status-warning" : "text-text-tertiary")}>
          {heard ? "Sensor data stale" : "No sensor data"}
        </span>
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
