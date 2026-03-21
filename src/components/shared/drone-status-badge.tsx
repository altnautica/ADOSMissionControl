"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import type { DroneStatus } from "@/lib/types";

interface DroneStatusBadgeProps {
  status: DroneStatus;
}

const variants: Record<DroneStatus, "success" | "warning" | "error" | "info" | "neutral"> = {
  online: "success",
  in_mission: "info",
  idle: "neutral",
  returning: "warning",
  maintenance: "error",
  offline: "neutral",
};

const STATUS_KEYS: Record<DroneStatus, string> = {
  online: "online",
  in_mission: "inMission",
  idle: "idle",
  returning: "returning",
  maintenance: "maintenance",
  offline: "offline",
};

export function DroneStatusBadge({ status }: DroneStatusBadgeProps) {
  const t = useTranslations("droneStatus");
  return <Badge variant={variants[status]}>{t(STATUS_KEYS[status])}</Badge>;
}
