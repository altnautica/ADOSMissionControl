/**
 * @module protocol/select-fc-adapter
 * @description Single selection seam for the protocol adapter used to drive a
 * flight controller reached through the ADOS agent. The agent advertises
 * `fc_variant` once it identifies the FC on the serial link; the byte-transparent
 * agent transports round-trip whichever protocol that FC speaks.
 * @license GPL-3.0-only
 */

import type { DroneProtocol } from "@/lib/protocol/types";

/**
 * Whether an FC-variant string names an MSP firmware (Betaflight/iNav), which
 * must be driven with the MSP adapter and relayed over the MSP topic lane.
 * ArduPilot / PX4 / unidentified / older-agent (absent) → false (MAVLink).
 */
export function isMspVariant(fcVariant: string | null | undefined): boolean {
  const v = fcVariant?.trim().toLowerCase();
  return v === "betaflight" || v === "inav";
}

/**
 * Construct the adapter for a protocol family. Both adapters stay dynamically
 * imported so the code-split boundary the agent bridge relies on is preserved.
 */
export async function createProtocolAdapter(protocol: "mavlink" | "msp"): Promise<DroneProtocol> {
  if (protocol === "msp") {
    const { MSPAdapter } = await import("./msp-adapter");
    return new MSPAdapter();
  }
  const { MAVLinkAdapter } = await import("./mavlink-adapter");
  return new MAVLinkAdapter();
}

/**
 * Choose the protocol adapter for an FC reached through the ADOS agent.
 *
 * The agent advertises `fc_variant` once it identifies the FC on the serial
 * link. Betaflight/iNav speak MSP, so they must be driven with the MSP adapter
 * over the same byte-transparent agent transport; ArduPilot / PX4 / an
 * unidentified FC / an older agent (variant absent) default to MAVLink.
 */
export function createFcAdapter(
  fcVariant: string | null | undefined,
): Promise<DroneProtocol> {
  return createProtocolAdapter(isMspVariant(fcVariant) ? "msp" : "mavlink");
}
