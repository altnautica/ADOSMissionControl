import { useCallback } from "react";
import { useDroneManager, selectSelectedDrone } from "@/stores/drone-manager";
import type {
  ProtocolCapabilities,
  FirmwareType,
  VehicleClass,
} from "@/lib/protocol/types";

interface FirmwareCapabilitiesResult {
  capabilities: ProtocolCapabilities | null;
  firmwareType: FirmwareType | null;
  vehicleClass: VehicleClass | null;
  isConnected: boolean;
  /** Check if a specific capability is supported */
  supports: (cap: keyof ProtocolCapabilities) => boolean;
}

const NOT_CONNECTED_SUPPORTS = () => false;

export function useFirmwareCapabilities(): FirmwareCapabilitiesResult {
  const drone = useDroneManager(selectSelectedDrone);

  const protocol = drone?.protocol;
  const isConnected = !!protocol?.isConnected;
  const capabilities = isConnected ? protocol!.getCapabilities() : null;
  const handler = isConnected ? protocol!.getFirmwareHandler() : null;
  const vehicleInfo = isConnected ? protocol!.getVehicleInfo() : null;

  const supports = useCallback(
    (cap: keyof ProtocolCapabilities) => !!capabilities?.[cap],
    [capabilities],
  );

  if (!isConnected) {
    return {
      capabilities: null,
      firmwareType: null,
      vehicleClass: null,
      isConnected: false,
      supports: NOT_CONNECTED_SUPPORTS,
    };
  }

  return {
    capabilities,
    firmwareType: handler?.firmwareType ?? vehicleInfo?.firmwareType ?? null,
    vehicleClass: handler?.vehicleClass ?? vehicleInfo?.vehicleClass ?? null,
    isConnected: true,
    supports,
  };
}
