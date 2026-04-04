"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useDroneManager, type ManagedDrone } from "@/stores/drone-manager";
import { formatDuration } from "@/lib/utils";
import { Unplug, Plane, SquareIcon, Waves, Truck, HelpCircle } from "lucide-react";

const VEHICLE_ICONS: Record<string, typeof Plane> = {
  copter: SquareIcon,
  plane: Plane,
  rover: Truck,
  sub: Waves,
  vtol: Plane,
  unknown: HelpCircle,
};

function DroneRow({
  drone,
  isSelected,
  onSelect,
  onDisconnect,
}: {
  drone: ManagedDrone;
  isSelected: boolean;
  onSelect: () => void;
  onDisconnect: () => void;
}) {
  const [uptime, setUptime] = useState(0);
  const [disconnecting, setDisconnecting] = useState(false);
  const t = useTranslations("connect");

  useEffect(() => {
    const start = drone.connectedAt;
    const interval = setInterval(() => {
      setUptime(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [drone.connectedAt]);

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      onDisconnect();
    } finally {
      setDisconnecting(false);
    }
  }

  const info = drone.vehicleInfo;
  const VehicleIcon = VEHICLE_ICONS[info.vehicleClass] || HelpCircle;
  const transportLabel = drone.transport.type === "webserial" ? "USB" : "WS";

  return (
    <div
      onClick={onSelect}
      className={`flex items-center justify-between gap-3 p-3 border cursor-pointer transition-colors ${
        isSelected
          ? "border-accent-primary/40 bg-accent-primary/5"
          : "border-border-default hover:border-border-strong"
      }`}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div
          className={`w-2 h-2 rounded-full shrink-0 ${
            isSelected ? "bg-status-success animate-pulse" : "bg-accent-primary"
          }`}
        />
        <VehicleIcon size={14} className="text-text-secondary shrink-0" />
        <div className="min-w-0">
          <p className="text-xs text-text-primary font-medium truncate">
            {drone.name}
          </p>
          <p className="text-[10px] text-text-tertiary font-mono">
            SYS {info.systemId} · {formatDuration(uptime)}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Badge variant={transportLabel === "USB" ? "info" : "neutral"}>
          {transportLabel}
        </Badge>
        {isSelected && <Badge variant="success">{t("activeBadge")}</Badge>}
        <Button
          variant="danger"
          size="sm"
          icon={<Unplug size={12} />}
          onClick={(e) => {
            e.stopPropagation();
            handleDisconnect();
          }}
          loading={disconnecting}
        >
          &times;
        </Button>
      </div>
    </div>
  );
}

export function ActiveConnections() {
  const t = useTranslations("connect");
  const drones = useDroneManager((s) => s.drones);
  const selectedDroneId = useDroneManager((s) => s.selectedDroneId);
  const selectDrone = useDroneManager((s) => s.selectDrone);

  const droneList = Array.from(drones.values());

  if (droneList.length === 0) {
    return (
      <p className="text-xs text-text-tertiary py-3">
        {t("noActiveConnectionsHelp")}
      </p>
    );
  }

  function handleDisconnect(drone: ManagedDrone) {
    window.dispatchEvent(
      new CustomEvent("request-disconnect", { detail: drone.id }),
    );
  }

  return (
    <div className="space-y-2">
      {droneList.map((drone) => (
        <DroneRow
          key={drone.id}
          drone={drone}
          isSelected={drone.id === selectedDroneId}
          onSelect={() => selectDrone(drone.id)}
          onDisconnect={() => handleDisconnect(drone)}
        />
      ))}
    </div>
  );
}
