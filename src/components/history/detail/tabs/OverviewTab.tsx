"use client";

/**
 * Overview tab — Flight Info + Metrics + per-category cards. Pure composer:
 * pulls the flight record from the store and renders each card from the
 * overview/ folder when its data is present.
 *
 * @license GPL-3.0-only
 */

import { useLocale, useTranslations } from "next-intl";
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
  const tk = useTranslations("history.overviewTab");
  const start = record.startTime ?? record.date;
  const batteries = useBatteryRegistryStore((s) => s.packs);
  const equipment = useEquipmentRegistryStore((s) => s.items);
  const locale = useLocale();
  return (
    <div className="flex flex-col gap-3">
      <Card title={tk("flightInfo")} padding={true}>
        <div className="flex flex-col gap-2">
          <Row label={tk("drone")} value={record.droneName} />
          {record.customName && <Row label={tk("name")} value={record.customName} />}
          <Row label={tk("date")} value={formatDate(start)} />
          <Row label={tk("start")} value={formatTime(start)} />
          {record.endTime !== start && <Row label={tk("end")} value={formatTime(record.endTime)} />}
          {record.takeoffPlaceName && <Row label={tk("place")} value={record.takeoffPlaceName} />}
          <Row label={tk("takeoff")} value={fmtCoord(record.takeoffLat, record.takeoffLon, locale)} mono />
          <Row label={tk("landing")} value={fmtCoord(record.landingLat, record.landingLon, locale)} mono />
          {record.landingPlaceName && (
            <Row label={tk("landingPlace")} value={record.landingPlaceName} />
          )}
        </div>
      </Card>

      <Card title={tk("metrics")} padding={true}>
        <div className="grid grid-cols-2 gap-3">
          <DataValue label={tk("duration")} value={formatDuration(record.duration)} />
          <DataValue label={tk("distance")} value={record.distance !== undefined ? formatDecimal(record.distance / 1000, 2, locale) : "—"} unit="km" />
          <DataValue label={tk("maxAltitude")} value={record.maxAlt ?? "—"} unit="m" />
          <DataValue label={tk("maxSpeed")} value={record.maxSpeed ?? "—"} unit="m/s" />
          {record.avgSpeed !== undefined && (
            <DataValue label={tk("avgSpeed")} value={record.avgSpeed} unit="m/s" />
          )}
          <DataValue label={tk("waypoints")} value={record.waypointCount} />
          {record.batteryUsed !== undefined ? (
            <DataValue label={tk("batteryUsed")} value={record.batteryUsed} unit="%" />
          ) : (
            <DataValue label={tk("batteryUsed")} value="—" />
          )}
          {record.batteryStartV !== undefined && (
            <DataValue label={tk("battStart")} value={formatDecimal(record.batteryStartV, 2, locale)} unit="V" />
          )}
          {record.batteryEndV !== undefined && (
            <DataValue label={tk("battEnd")} value={formatDecimal(record.batteryEndV, 2, locale)} unit="V" />
          )}
        </div>
      </Card>

      {/* AI summary + suggested tags */}
      <SummaryCard record={record} />

      {record.adherence && (
        <Card title={tk("missionAdherence")} padding={true}>
          <AdherenceCard
            adherence={record.adherence}
            missionName={record.missionName}
          />
        </Card>
      )}

      {record.geofenceBreaches && record.geofenceBreaches.length > 0 && (
        <Card title={tk("geofence")} padding={true}>
          <GeofenceCard breaches={record.geofenceBreaches} />
        </Card>
      )}

      {record.phases && record.phases.length > 0 && (
        <Card title={tk("phases")} padding={true}>
          <PhasesCard phases={record.phases} />
        </Card>
      )}

      {(record.sunMoon || record.weatherSnapshot || record.windEstimate) && (
        <Card title={tk("conditions")} padding={true}>
          <ConditionsCard sunMoon={record.sunMoon} weather={record.weatherSnapshot} />
          {record.windEstimate && <WindCard wind={record.windEstimate} hasMetar={!!record.weatherSnapshot} />}
        </Card>
      )}

      {record.preflight && (
        <Card title={tk("preFlight")} padding={true}>
          <PreflightCard preflight={record.preflight} />
        </Card>
      )}

      {record.loadout && (
        <Card title={tk("loadout")} padding={true}>
          <div className="flex flex-col gap-2">
            {(record.loadout.batteryIds ?? []).length > 0 && (
              <Row
                label={tk("batteries")}
                value={(record.loadout.batteryIds ?? [])
                  .map((id) => batteries[id]?.label ?? id)
                  .join(", ")}
              />
            )}
            {record.loadout.propSetId && (
              <Row label={tk("propSet")} value={equipment[record.loadout.propSetId]?.label ?? record.loadout.propSetId} />
            )}
            {record.loadout.motorSetId && (
              <Row label={tk("motorSet")} value={equipment[record.loadout.motorSetId]?.label ?? record.loadout.motorSetId} />
            )}
            {record.loadout.escSetId && (
              <Row label={tk("escSet")} value={equipment[record.loadout.escSetId]?.label ?? record.loadout.escSetId} />
            )}
            {record.loadout.cameraId && (
              <Row label={tk("camera")} value={equipment[record.loadout.cameraId]?.label ?? record.loadout.cameraId} />
            )}
            {record.loadout.gimbalId && (
              <Row label={tk("gimbal")} value={equipment[record.loadout.gimbalId]?.label ?? record.loadout.gimbalId} />
            )}
            {record.loadout.payloadId && (
              <Row label={tk("payload")} value={equipment[record.loadout.payloadId]?.label ?? record.loadout.payloadId} />
            )}
            {record.loadout.frameId && (
              <Row label={tk("frame")} value={equipment[record.loadout.frameId]?.label ?? record.loadout.frameId} />
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
