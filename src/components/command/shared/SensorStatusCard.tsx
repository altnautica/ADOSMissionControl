"use client";

import { Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSensorHealthStore } from "@/stores/sensor-health-store";

interface SensorStatusCardProps {
  className?: string;
}

// DEC-108 Phase D: filter the 32-bit MAVLink sensor bitmap down to the
// sensors a bench operator actually wants to verify. Hides the noisy
// boolean controls (rate control, attitude stabilization, etc.) which
// are decision-flags rather than physical hardware.
const PHYSICAL_SENSOR_NAMES = new Set([
  "gyro_3d",
  "accel_3d",
  "mag_3d",
  "abs_pressure",
  "diff_pressure",
  "gps",
  "optical_flow",
  "vision_position",
  "laser_position",
  "rc_receiver",
  "gyro2_3d",
  "accel2_3d",
  "mag2_3d",
  "ahrs",
  "battery",
  "proximity",
  "logging",
  "geofence",
  "pre_arm_check",
]);

// Short labels for compact chip rendering
const SHORT_LABELS: Record<string, string> = {
  gyro_3d: "Gyro",
  accel_3d: "Accel",
  mag_3d: "Mag",
  abs_pressure: "Baro",
  diff_pressure: "Pitot",
  gps: "GPS",
  optical_flow: "Flow",
  vision_position: "Vision",
  laser_position: "LiDAR",
  rc_receiver: "RC",
  gyro2_3d: "Gyro2",
  accel2_3d: "Accel2",
  mag2_3d: "Mag2",
  ahrs: "AHRS",
  battery: "Batt",
  proximity: "Prox",
  logging: "Log",
  geofence: "Fence",
  pre_arm_check: "PreArm",
};

function statusColor(status: string): string {
  switch (status) {
    case "healthy":
      return "bg-green-500/80";
    case "unhealthy":
      return "bg-gray-500/60";
    case "error":
      return "bg-red-500/80";
    case "not_present":
      return "bg-transparent border border-text-tertiary/30";
    default:
      return "bg-gray-700/60";
  }
}

export function SensorStatusCard({ className }: SensorStatusCardProps) {
  const sensors = useSensorHealthStore((s) => s.sensors);
  const lastUpdate = useSensorHealthStore((s) => s.lastUpdate);

  // Only render physical sensors that the FC reports as present.
  // Sensors not in the bitmap (e.g. no SYS_STATUS yet) are skipped.
  const visible = sensors.filter(
    (s) => PHYSICAL_SENSOR_NAMES.has(s.name) && s.present,
  );

  const healthyCount = visible.filter((s) => s.status === "healthy").length;
  const totalCount = visible.length;

  return (
    <div className={cn("border border-border-default rounded-lg p-4", className)}>
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Activity className="w-3.5 h-3.5 text-text-tertiary" />
          <span className="text-xs font-medium text-text-secondary">Sensors</span>
        </div>
        {totalCount > 0 && (
          <span className="text-[10px] font-mono text-text-tertiary">
            {healthyCount}/{totalCount} healthy
          </span>
        )}
      </div>

      {/* Sensor grid */}
      {totalCount === 0 ? (
        <div className="text-[10px] text-text-tertiary text-center py-3">
          {lastUpdate === 0 ? "Waiting for SYS_STATUS..." : "No sensors reported"}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-1.5">
          {visible.map((s) => (
            <div
              key={s.bit}
              title={`${s.label} (bit ${s.bit}) — ${s.status}${s.enabled ? "" : " · disabled"}`}
              className="flex items-center gap-1.5 px-2 py-1 rounded bg-white/[0.02]"
            >
              <span
                className={cn(
                  "w-1.5 h-1.5 rounded-full flex-shrink-0",
                  statusColor(s.status),
                )}
              />
              <span className="text-[10px] font-mono text-text-secondary truncate">
                {SHORT_LABELS[s.name] ?? s.label}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
