"use client";

/**
 * Flight status badge and duration cell shared by the Flight logs table and
 * a drone's Flights tab. The badge shows the translated status, never the
 * stored enum; a flight still recording shows its elapsed time, since its
 * stored duration is only written when it ends.
 *
 * @license GPL-3.0-only
 */

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { formatDuration } from "@/lib/utils";
import { subscribeToClock, useClockStore } from "@/stores/clock-store";
import type { FlightRecord } from "@/lib/types";

type FlightStatus = FlightRecord["status"];

const STATUS_VARIANT: Record<FlightStatus, "success" | "warning" | "error" | "neutral"> = {
  completed: "success",
  aborted: "warning",
  emergency: "error",
  in_progress: "neutral",
};

const STATUS_KEY: Record<FlightStatus, "completed" | "aborted" | "emergency" | "inProgress"> = {
  completed: "completed",
  aborted: "aborted",
  emergency: "emergency",
  in_progress: "inProgress",
};

export function FlightStatusBadge({
  status,
  size,
}: {
  status: FlightStatus;
  size?: "sm" | "md";
}) {
  const t = useTranslations("history");
  const key = STATUS_KEY[status];
  return (
    <Badge variant={STATUS_VARIANT[status] ?? "neutral"} size={size}>
      {key ? t(key) : status}
    </Badge>
  );
}

function ElapsedDuration({ since }: { since: number }) {
  useEffect(() => subscribeToClock(), []);
  const now = useClockStore((s) => s.now);
  return <>{formatDuration(Math.max(0, Math.floor((now - since) / 1000)))}</>;
}

/** Stored duration, or the live elapsed time while the flight records. */
export function FlightDuration({ record }: { record: FlightRecord }) {
  if (record.status === "in_progress") {
    const since = record.startTime ?? record.date;
    if (since) return <ElapsedDuration since={since} />;
  }
  return <>{formatDuration(record.duration)}</>;
}
