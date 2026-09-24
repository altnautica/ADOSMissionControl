/**
 * @module protocol/connect-with-detection
 * @description Shared connect helper that probes a freshly-opened transport for
 * the FC protocol family, selects the matching adapter, and completes the
 * handshake. A directly-plugged Betaflight/iNav FC speaks MSP, so connecting it
 * with the MAVLink adapter fails; every direct-connect panel routes through here
 * so the right adapter is chosen from what the FC actually replies with.
 *
 * The probe is safe on any FC: a MAVLink autopilot ignores the MSP request
 * frames, and an MSP FC ignores the MAVLink heartbeat probe.
 * @license GPL-3.0-only
 */

import { detectProtocol } from "./detector";
import { createProtocolAdapter } from "./select-fc-adapter";
import type {
  DroneProtocol,
  FirmwareType,
  Transport,
  VehicleInfo,
} from "./types";

/**
 * Detect the FC protocol on `transport`, select the adapter, and connect.
 *
 * The detector attaches its own temporary `data` listener while probing and
 * removes it before resolving (both its match and timeout paths call the
 * unsubscribe), so the adapter's `connect()` gets an unencumbered transport and
 * there is no double-consumption of incoming frames.
 *
 * @param transport An already-connected byte-level transport.
 * @returns The connected adapter, the vehicle identity, and the detected
 *   firmware family (persist this so a reconnect re-selects the same adapter).
 */
export async function connectWithDetection(transport: Transport): Promise<{
  adapter: DroneProtocol;
  vehicleInfo: VehicleInfo;
  firmwareType: FirmwareType;
}> {
  const send = (data: Uint8Array) => transport.send(data);
  const onData = (handler: (data: Uint8Array) => void) => {
    transport.on("data", handler);
    return () => transport.off("data", handler);
  };

  const detection = await detectProtocol(send, onData);
  // A confirmed MSP link takes the MSP adapter whatever its variant: the
  // variant only names the family, and an unmodeled MSP board is still MSP.
  const adapter = await createProtocolAdapter(detection.protocol === "msp" ? "msp" : "mavlink");
  const vehicleInfo = await adapter.connect(transport);

  return { adapter, vehicleInfo, firmwareType: detection.firmwareType };
}
