/**
 * @module fc/firmware/firmware-state/use-ardupilot-firmware
 * @description Owns the ArduPilot slice of the firmware picker: board /
 * version catalog state, the manifest + version loaders, and the
 * effects that load versions on a board/vehicle change and preselect the
 * vehicle firmware (Copter / Plane / Rover / Sub) of a connected drone.
 * @license GPL-3.0-only
 */

"use client";

import { useEffect, useState } from "react";
import type { ManagedDrone } from "@/stores/drone-manager";
import type { FirmwareStack, ManifestBoard } from "@/lib/protocol/firmware/types";
import { apManifest } from "./manifests";

/** The ArduPilot firmware a connected vehicle class runs (a QuadPlane is Plane). */
const FIRMWARE_FOR_CLASS: Record<string, string> = {
  copter: "Copter",
  plane: "Plane",
  vtol: "Plane",
  rover: "Rover",
  sub: "Sub",
};

export function useArduPilotFirmware(
  firmwareStack: FirmwareStack,
  drone: ManagedDrone | null,
) {
  const [apBoards, setApBoards] = useState<ManifestBoard[]>([]);
  const [apLoading, setApLoading] = useState(false);
  const [apError, setApError] = useState("");
  const [apVersions, setApVersions] = useState<string[]>([]);
  const [selectedApBoard, setSelectedApBoard] = useState("");
  const [selectedVehicleType, setSelectedVehicleType] = useState("Copter");
  const [selectedApVersion, setSelectedApVersion] = useState("");

  async function loadApManifest() {
    setApLoading(true); setApError("");
    try {
      await apManifest.getManifest();
      const boardList = await apManifest.getBoards();
      setApBoards(boardList);
      if (boardList.length > 0 && !selectedApBoard) setSelectedApBoard(boardList[0].name);
    } catch (err) { setApError(err instanceof Error ? err.message : "Failed to load ArduPilot manifest"); }
    finally { setApLoading(false); }
  }

  async function loadApVersions(board: string, vehicleType: string) {
    try {
      const v = await apManifest.getVersions(board, vehicleType);
      setApVersions(v);
      if (v.length > 0) {
        const stable = v.find((x) => x.toLowerCase().startsWith("stable") || x === "OFFICIAL") ?? v[0];
        setSelectedApVersion(stable);
      }
    } catch { setApVersions([]); }
  }

  useEffect(() => {
    if (firmwareStack === "ardupilot" && selectedApBoard && selectedVehicleType) {
      setSelectedApVersion("");
      loadApVersions(selectedApBoard, selectedVehicleType);
    }
  }, [selectedApBoard, selectedVehicleType, firmwareStack]);

  // Preselect the connected vehicle's firmware whenever its class becomes
  // known or changes; the operator's own pick stands until then.
  const vehicleClass = drone?.vehicleInfo.vehicleClass;
  useEffect(() => {
    if (firmwareStack !== "ardupilot" || !vehicleClass) return;
    const type = FIRMWARE_FOR_CLASS[vehicleClass];
    if (type) setSelectedVehicleType(type);
  }, [vehicleClass, firmwareStack]);

  return {
    apBoards, apLoading, apError, apVersions,
    selectedApBoard, setSelectedApBoard,
    selectedVehicleType, setSelectedVehicleType,
    selectedApVersion, setSelectedApVersion,
    loadApManifest,
    loadApManifestRetry: () => { apManifest.clearCache(); loadApManifest(); },
  };
}
