"use client";

import { useState, useEffect } from "react";
import { useDroneManager, selectSelectedDrone } from "@/stores/drone-manager";
import { loadParamMetadata, type ParamMetadata } from "@/lib/protocol/param-metadata";

const EMPTY_MAP = new Map<string, ParamMetadata>();

/**
 * Hook to fetch and cache parameter metadata for the connected drone's firmware.
 * Works for every firmware (ArduPilot/PX4/iNav/Betaflight) and offline (the
 * bundled floor). Returns an empty Map when no drone is connected.
 */
export function useParamMetadataMap(): Map<string, ParamMetadata> {
  const [metadata, setMetadata] = useState<Map<string, ParamMetadata>>(EMPTY_MAP);
  const drone = useDroneManager(selectSelectedDrone);

  useEffect(() => {
    const info = drone?.vehicleInfo;
    if (!info) return;
    let cancelled = false;
    loadParamMetadata({
      firmwareType: info.firmwareType,
      vehicleClass: info.vehicleClass,
      firmwareVersion: info.firmwareVersionString,
      protocol: drone?.protocol,
    }).then((map) => {
      if (!cancelled) setMetadata(map);
    });
    return () => { cancelled = true; };
    // `drone?.protocol` is read fresh from the closure above whenever this
    // effect re-runs; it is not itself a re-run trigger since it becomes
    // available at the same moment as vehicleInfo and does not change
    // identity for the lifetime of a given ManagedDrone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drone?.vehicleInfo?.firmwareType, drone?.vehicleInfo?.firmwareVersionString, drone?.vehicleInfo?.vehicleClass]);

  return metadata;
}
