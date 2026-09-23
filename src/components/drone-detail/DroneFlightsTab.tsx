"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Table, type Column } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useHistoryStore } from "@/stores/history-store";
import { formatDate, formatDuration } from "@/lib/utils";
import { LinkUpPlaceholder } from "@/components/shared/link-up/LinkUpPlaceholder";
import type { FlightRecord } from "@/lib/types";

interface DroneFlightsTabProps {
  droneId: string;
}

type FlightRecordRow = FlightRecord & Record<string, unknown>;

const statusVariant: Record<string, "success" | "warning" | "error"> = {
  completed: "success",
  aborted: "warning",
  emergency: "error",
};

export function DroneFlightsTab({ droneId }: DroneFlightsTabProps) {
  const t = useTranslations("droneDetail");

  const columns: Column<FlightRecordRow>[] = useMemo(() => [
    {
      key: "date",
      label: t("flightDate"),
      sortable: true,
      width: "18%",
      render: (row) => (
        <span className="font-mono text-text-primary tabular-nums">
          {formatDate(row.date)}
        </span>
      ),
    },
    {
      key: "duration",
      label: t("flightDuration"),
      sortable: true,
      width: "14%",
      render: (row) => (
        <span className="font-mono text-text-primary tabular-nums">
          {formatDuration(row.duration)}
        </span>
      ),
    },
    {
      key: "distance",
      label: t("flightDistance"),
      sortable: true,
      width: "14%",
      render: (row) => (
        <span className="font-mono text-text-primary tabular-nums">
          {row.distance !== undefined ? `${(row.distance / 1000).toFixed(1)} km` : "—"}
        </span>
      ),
    },
    {
      key: "maxAlt",
      label: t("flightMaxAlt"),
      sortable: true,
      width: "12%",
      render: (row) => (
        <span className="font-mono text-text-primary tabular-nums">
          {row.maxAlt !== undefined ? `${row.maxAlt}m` : "—"}
        </span>
      ),
    },
    {
      key: "status",
      label: t("flightStatus"),
      sortable: true,
      width: "14%",
      render: (row) => (
        <Badge variant={statusVariant[row.status] || "neutral"}>
          {row.status}
        </Badge>
      ),
    },
    {
      key: "batteryUsed",
      label: t("flightBattery"),
      sortable: true,
      width: "14%",
      render: (row) => (
        <span className="font-mono text-text-primary tabular-nums">
          {row.batteryUsed !== undefined ? `${row.batteryUsed}%` : "—"}
        </span>
      ),
    },
  ], [t]);
  // Source from the history store (single source of truth) so this view stays
  // in sync with live recordings, imported logs, and demo seed data alike.
  const allRecords = useHistoryStore((s) => s.records);
  const flights = useMemo(
    () => allRecords.filter((f) => f.droneId === droneId),
    [allRecords, droneId],
  );

  if (flights.length === 0) {
    return <LinkUpPlaceholder variant="no-flights" />;
  }

  return (
    <div className="flex-1 overflow-auto p-3">
      <div className="text-xs text-text-secondary mb-2">
        {t("flightsRecorded", { count: flights.length })}
      </div>
      <Table
        columns={columns}
        data={flights as FlightRecordRow[]}
        rowKey={(row) => row.id}
      />
    </div>
  );
}
