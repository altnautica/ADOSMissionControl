"use client";

/**
 * Overview tab — Flight Info + Metrics + per-category cards. Pure composer:
 * pulls the flight record from the store and renders each card from the
 * overview/ folder when its data is present.
 *
 * @license GPL-3.0-only
 */

import { useLocale } from "next-intl";
import { Card } from "@/components/ui/card";
import { DataValue } from "@/components/ui/data-value";
import { formatDate, formatDuration, formatTime } from "@/lib/utils";
import { formatDecimal } from "@/lib/i18n/format";
import { useBatteryRegistryStore } from "@/stores/battery-registry-store";
import { useEquipmentRegistryStore } from "@/stores/equipment-registry-store";
import type { FlightRecord } from "@/lib/types";

import { Row, fmtCoord } from "./overview/shared";
import { SummaryCard } from "./overview/SummaryCard";
import { ConditionsCard } from "./overview/ConditionsCard";
import { WindCard } from "./overview/WindCard";
import { GeofenceCard } from "./overview/GeofenceCard";
import { AdherenceCard } from "./overview/AdherenceCard";
import { PhasesCard } from "./overview/PhasesCard";
import { PreflightCard } from "./overview/PreflightCard";

interface OverviewTabProps {
  record: FlightRecord;
}

export function OverviewTab({ record }: OverviewTabProps) {
  const start = record.startTime ?? record.date;
  const batteries = useBatteryRegistryStore((s) => s.packs);
  const equipment = useEquipmentRegistryStore((s) => s.items);
  const locale = useLocale();
  return (
    <div className="flex flex-col gap-3">
      <Card title="Flight Info" padding={true}>
        <div className="flex flex-col gap-2">
          <Row label="Drone" value={record.droneName} />
          {record.customName && <Row label="Name" value={record.customName} />}
          <Row label="Date" value={formatDate(start)} />
          <Row label="Start" value={formatTime(start)} />
          {record.endTime !== start && <Row label="End" value={formatTime(record.endTime)} />}
          {record.takeoffPlaceName && <Row label="Place" value={record.takeoffPlaceName} />}
          <Row label="Takeoff" value={fmtCoord(record.takeoffLat, record.takeoffLon, locale)} mono />
          <Row label="Landing" value={fmtCoord(record.landingLat, record.landingLon, locale)} mono />
          {record.landingPlaceName && (
            <Row label="Landing place" value={record.landingPlaceName} />
          )}
        </div>
      </Card>

      <Card title="Metrics" padding={true}>
        <div className="grid grid-cols-2 gap-3">
          <DataValue label="Duration" value={formatDuration(record.duration)} />
          <DataValue label="Distance" value={record.distance !== undefined ? formatDecimal(record.distance / 1000, 2, locale) : "—"} unit="km" />
          <DataValue label="Max Altitude" value={record.maxAlt ?? "—"} unit="m" />
          <DataValue label="Max Speed" value={record.maxSpeed ?? "—"} unit="m/s" />
          {record.avgSpeed !== undefined && (
            <DataValue label="Avg Speed" value={record.avgSpeed} unit="m/s" />
          )}
          <DataValue label="Waypoints" value={record.waypointCount} />
          {record.batteryUsed !== undefined ? (
            <DataValue label="Battery Used" value={record.batteryUsed} unit="%" />
          ) : (
            <DataValue label="Battery Used" value="—" />
          )}
          {record.batteryStartV !== undefined && (
            <DataValue label="Batt Start" value={formatDecimal(record.batteryStartV, 2, locale)} unit="V" />
          )}
          {record.batteryEndV !== undefined && (
            <DataValue label="Batt End" value={formatDecimal(record.batteryEndV, 2, locale)} unit="V" />
          )}
        </div>
      </Card>

      {/* AI summary + suggested tags */}
      <SummaryCard record={record} />

      {record.adherence && (
        <Card title="Mission Adherence" padding={true}>
          <AdherenceCard
            adherence={record.adherence}
            missionName={record.missionName}
          />
        </Card>
      )}

      {record.geofenceBreaches && record.geofenceBreaches.length > 0 && (
        <Card title="Geofence" padding={true}>
          <GeofenceCard breaches={record.geofenceBreaches} />
        </Card>
      )}

      {record.phases && record.phases.length > 0 && (
        <Card title="Phases" padding={true}>
          <PhasesCard phases={record.phases} />
        </Card>
      )}

      {(record.sunMoon || record.weatherSnapshot || record.windEstimate) && (
        <Card title="Conditions" padding={true}>
          <ConditionsCard sunMoon={record.sunMoon} weather={record.weatherSnapshot} />
          {record.windEstimate && <WindCard wind={record.windEstimate} hasMetar={!!record.weatherSnapshot} />}
        </Card>
      )}

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
