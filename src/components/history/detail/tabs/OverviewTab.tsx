"use client";

/**
 * Overview tab — Flight Info + Metrics cards.
 *
 * @license GPL-3.0-only
 */

import { Card } from "@/components/ui/card";
import { DataValue } from "@/components/ui/data-value";
import { formatDate, formatDuration, formatTime } from "@/lib/utils";
import { useBatteryRegistryStore } from "@/stores/battery-registry-store";
import { useEquipmentRegistryStore } from "@/stores/equipment-registry-store";
import { CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import type { FlightRecord, PreflightSnapshot } from "@/lib/types";

interface OverviewTabProps {
  record: FlightRecord;
}

function fmtCoord(lat?: number, lon?: number): string {
  if (lat === undefined || lon === undefined) return "—";
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

export function OverviewTab({ record }: OverviewTabProps) {
  const start = record.startTime ?? record.date;
  const batteries = useBatteryRegistryStore((s) => s.packs);
  const equipment = useEquipmentRegistryStore((s) => s.items);
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

      {record.preflight && (
        <Card title="Pre-flight" padding={true}>
          <PreflightCard preflight={record.preflight} />
        </Card>
      )}

      {record.loadout && (
        <Card title="Loadout" padding={true}>
          <div className="flex flex-col gap-2">
            {(record.loadout.batteryIds ?? []).length > 0 && (
              <Row
                label="Batteries"
                value={(record.loadout.batteryIds ?? [])
                  .map((id) => batteries[id]?.label ?? id)
                  .join(", ")}
              />
            )}
            {record.loadout.propSetId && (
              <Row label="Prop set" value={equipment[record.loadout.propSetId]?.label ?? record.loadout.propSetId} />
            )}
            {record.loadout.motorSetId && (
              <Row label="Motor set" value={equipment[record.loadout.motorSetId]?.label ?? record.loadout.motorSetId} />
            )}
            {record.loadout.escSetId && (
              <Row label="ESC set" value={equipment[record.loadout.escSetId]?.label ?? record.loadout.escSetId} />
            )}
            {record.loadout.cameraId && (
              <Row label="Camera" value={equipment[record.loadout.cameraId]?.label ?? record.loadout.cameraId} />
            )}
            {record.loadout.gimbalId && (
              <Row label="Gimbal" value={equipment[record.loadout.gimbalId]?.label ?? record.loadout.gimbalId} />
            )}
            {record.loadout.payloadId && (
              <Row label="Payload" value={equipment[record.loadout.payloadId]?.label ?? record.loadout.payloadId} />
            )}
            {record.loadout.frameId && (
              <Row label="Frame" value={equipment[record.loadout.frameId]?.label ?? record.loadout.frameId} />
            )}
            {record.loadout.rcTxId && (
              <Row label="RC TX" value={equipment[record.loadout.rcTxId]?.label ?? record.loadout.rcTxId} />
            )}
          </div>
        </Card>
      )}
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

function PreflightCard({ preflight }: { preflight: PreflightSnapshot }) {
  const items = preflight.checklistItems ?? [];
  const passed = items.filter((i) => i.status === "pass").length;
  const skipped = items.filter((i) => i.status === "skipped").length;
  const failed = items.filter((i) => i.status === "fail").length;
  const pending = items.filter((i) => i.status === "pending").length;

  return (
    <div className="flex flex-col gap-2">
      {/* Summary */}
      <div className="flex items-center gap-3 text-[11px]">
        {preflight.checklistComplete ? (
          <span className="inline-flex items-center gap-1 text-status-success">
            <CheckCircle2 size={12} />
            Checklist complete
          </span>
        ) : items.length === 0 ? (
          <span className="text-text-tertiary">No checklist captured</span>
        ) : (
          <span className="inline-flex items-center gap-1 text-status-warning">
            <AlertTriangle size={12} />
            Checklist incomplete
          </span>
        )}
        {items.length > 0 && (
          <span className="text-[10px] font-mono text-text-tertiary">
            {passed} pass · {skipped} skip · {failed} fail · {pending} pending
          </span>
        )}
      </div>

      {/* Failed items called out explicitly */}
      {failed > 0 && (
        <ul className="flex flex-col gap-0.5">
          {items
            .filter((i) => i.status === "fail")
            .map((i) => (
              <li key={i.id} className="flex items-center gap-1.5 text-[10px] text-status-error">
                <XCircle size={10} />
                {i.label}
                {i.displayValue && <span className="text-text-tertiary font-mono">· {i.displayValue}</span>}
              </li>
            ))}
        </ul>
      )}

      {/* Prearm STATUSTEXT failures (ArduPilot only) */}
      {preflight.prearmFailures && preflight.prearmFailures.length > 0 && (
        <div className="flex flex-col gap-0.5 mt-1">
          <span className="text-[10px] uppercase tracking-wider text-text-tertiary">FC prearm warnings</span>
          {preflight.prearmFailures.map((line, i) => (
            <span
              key={`${line}-${i}`}
              className="text-[10px] text-status-warning font-mono truncate"
              title={line}
            >
              {line}
            </span>
          ))}
        </div>
      )}

      {/* SYS_STATUS bitmasks */}
      {preflight.sysStatusHealth !== undefined && (
        <div className="flex flex-col gap-0.5 mt-1 text-[10px] font-mono text-text-tertiary">
          <span>Health: 0x{preflight.sysStatusHealth.toString(16).padStart(8, "0")}</span>
          {preflight.sysStatusEnabled !== undefined && (
            <span>Enabled: 0x{preflight.sysStatusEnabled.toString(16).padStart(8, "0")}</span>
          )}
          {preflight.sysStatusPresent !== undefined && (
            <span>Present: 0x{preflight.sysStatusPresent.toString(16).padStart(8, "0")}</span>
          )}
        </div>
      )}
    </div>
  );
}
