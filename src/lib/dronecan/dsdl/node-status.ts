/**
 * @module node-status
 * @description Codec for `uavcan.protocol.NodeStatus` (data type id 341).
 *
 * Wire layout (56 bits, 7 bytes total — fits a single CAN frame, no CRC):
 *   uint32  uptime_sec                       (bytes 0..3, little-endian)
 *   uint2   health                           (byte 4, bits 7..6)
 *   uint3   mode                             (byte 4, bits 5..3)
 *   uint3   sub_mode                         (byte 4, bits 2..0)
 *   uint16  vendor_specific_status_code      (bytes 5..6, little-endian)
 *
 * DroneCAN fills each byte from its most significant bit, so the first field
 * of byte 4 (health) sits in its top two bits. `sub_mode` is reserved: it is
 * written as zero and ignored on receive.
 * @license GPL-3.0-only
 */

export const HEALTH_OK = 0;
export const HEALTH_WARNING = 1;
export const HEALTH_ERROR = 2;
export const HEALTH_CRITICAL = 3;

export const MODE_OPERATIONAL = 0;
export const MODE_INITIALIZATION = 1;
export const MODE_MAINTENANCE = 2;
export const MODE_SOFTWARE_UPDATE = 3;
export const MODE_OFFLINE = 7;

export type NodeHealth = 0 | 1 | 2 | 3;
export type NodeMode = 0 | 1 | 2 | 3 | 7;

export interface NodeStatus {
  uptime_sec: number;
  health: NodeHealth;
  mode: NodeMode;
  vendor_specific_status_code: number;
}

/** Wire size of NodeStatus in bytes. */
export const NODE_STATUS_SIZE = 7;

export function encodeNodeStatus(status: NodeStatus): Uint8Array {
  const buf = new Uint8Array(NODE_STATUS_SIZE);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, status.uptime_sec >>> 0, true);
  buf[4] = ((status.health & 0x3) << 6) | ((status.mode & 0x7) << 3);
  dv.setUint16(5, status.vendor_specific_status_code & 0xffff, true);
  return buf;
}

export function decodeNodeStatus(buf: Uint8Array): NodeStatus {
  if (buf.length < NODE_STATUS_SIZE) {
    throw new Error(`NodeStatus payload too short: ${buf.length}`);
  }
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const packed = buf[4];
  return {
    uptime_sec: dv.getUint32(0, true),
    health: (packed >>> 6) as NodeHealth,
    mode: ((packed >>> 3) & 0x7) as NodeMode,
    vendor_specific_status_code: dv.getUint16(5, true),
  };
}
