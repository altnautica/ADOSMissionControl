/**
 * @module can-handlers
 * @description MAVLink CAN_FRAME (msg 386) decoder and handler.
 * Provides raw CAN bus frames passing through MAVLink's CAN passthrough.
 * @license GPL-3.0-only
 */

import type { CanFrameCallback } from "../types/callbacks";

/**
 * Decode a CAN_FRAME (msg 386) payload.
 *
 * Field layout (16 bytes, little-endian):
 *   uint32 id              (offset 0)  — CAN identifier (11-bit or 29-bit)
 *   uint8  target_system   (offset 4)
 *   uint8  target_component(offset 5)
 *   uint8  bus             (offset 6)
 *   uint8  len             (offset 7)
 *   uint8  data[8]         (offset 8)
 */
function decodeCanFrame(dv: DataView): {
  id: number;
  targetSystem: number;
  targetComponent: number;
  bus: number;
  len: number;
  data: Uint8Array;
} {
  const id = dv.getUint32(0, true);
  const targetSystem = dv.getUint8(4);
  const targetComponent = dv.getUint8(5);
  const bus = dv.getUint8(6);
  const len = dv.getUint8(7);
  const data = new Uint8Array(8);
  for (let i = 0; i < 8; i++) {
    data[i] = dv.getUint8(8 + i);
  }
  return { id, targetSystem, targetComponent, bus, len, data };
}

export function handleCanFrame(payload: DataView, callbacks: CanFrameCallback[]): void {
  if (callbacks.length === 0) return;
  const decoded = decodeCanFrame(payload);
  const timestamp = Date.now();
  for (const cb of callbacks) {
    cb({
      timestamp,
      bus: decoded.bus,
      len: decoded.len,
      targetSystem: decoded.targetSystem,
      targetComponent: decoded.targetComponent,
      id: decoded.id,
      data: decoded.data,
    });
  }
}
