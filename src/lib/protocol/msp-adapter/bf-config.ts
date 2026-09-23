/**
 * Betaflight binary config blocks over MSP: serial ports, OSD, LED strip,
 * receiver and DShot commands.
 *
 * Writes here only reach the FC's RAM; the adapter ends each one with
 * MSP_EEPROM_WRITE so the change survives a power cycle.
 *
 * @module protocol/msp-adapter/bf-config
 */

import type { CommandResult } from '../types'
import type { MspSerialQueue } from '../msp/msp-serial-queue'
import { MSP, MSP2 } from '../msp/msp-constants'
import { decodeMspSerialConfig, decodeMspSerialConfig2, type MspSerialPort } from '../msp/decoders/config/serial'
import { decodeMspRxConfig, decodeMspRxMap, type BfRxConfig } from '../msp/decoders/config/rx'
import { encodeMspSetSerialConfig, encodeMspSetSerialConfig2, encodeMspSendDshotCommand, encodeMspSetRxConfig, encodeMspSetRxMap } from '../msp/encoders/config'
import { decodeMspOsdConfig, type MspOsdConfig, type MspOsdGeneralConfig } from '../msp/decoders/config/osd'
import { decodeMspLedStripConfig, decodeMspLedColors, decodeMspLedStripModeColors, type HsvColor, type BfLedModeColor } from '../msp/decoders/config/led'
import { encodeMspSetOsdConfig, encodeMspOsdCharWrite, encodeMspSetLedStripConfigEntry, encodeMspSetLedColors, encodeMspSetLedStripModeColor, encodeMspSetOsdGeneralConfig } from '../msp/encoders/osd-led'
import { decodeMspVtxConfig } from '../msp/decoders/config/vtx'
import { decodeMspVtxTablePowerLevel, type MspVtxTablePowerLevel } from '../msp/msp-decoders-ext'

const OK: CommandResult = { success: true, resultCode: 0, message: 'OK' }

function requireQueue(queue: MspSerialQueue | null): MspSerialQueue {
  if (!queue) throw new Error('Not connected to flight controller')
  return queue
}

async function read(queue: MspSerialQueue | null, cmd: number): Promise<DataView> {
  const p = (await requireQueue(queue).send(cmd)).payload
  return new DataView(p.buffer, p.byteOffset, p.byteLength)
}

// ── Serial ports (MSP2_COMMON_SERIAL_CONFIG, legacy MSP_CF_SERIAL_CONFIG) ──

/**
 * Read the per-UART serial-port configuration. Prefers the 32-bit MSP2 config
 * and falls back to the legacy U16 one; `extended` says which answered.
 */
export async function bfGetSerialConfig(queue: MspSerialQueue | null): Promise<{ ports: MspSerialPort[]; extended: boolean }> {
  try {
    return { ports: decodeMspSerialConfig2(await read(queue, MSP2.MSP2_COMMON_SERIAL_CONFIG)).ports, extended: true }
  } catch {
    return { ports: decodeMspSerialConfig(await read(queue, MSP.MSP_CF_SERIAL_CONFIG)).ports, extended: false }
  }
}

/** Write the serial-port configuration with the same transport the read used. */
export async function bfSetSerialConfig(queue: MspSerialQueue | null, ports: MspSerialPort[], extended: boolean): Promise<CommandResult> {
  const q = requireQueue(queue)
  if (extended) await q.send(MSP2.MSP2_COMMON_SET_SERIAL_CONFIG, encodeMspSetSerialConfig2(ports))
  else await q.send(MSP.MSP_SET_CF_SERIAL_CONFIG, encodeMspSetSerialConfig(ports))
  return OK
}

/**
 * Send a DShot special command (beacon, spin direction, 3D mode, save). The
 * FC only acts on these while disarmed; fire-and-forget (no reply).
 */
export function bfSendDshotCommand(queue: MspSerialQueue | null, commandType: number, motorIndex: number, commands: number[]): CommandResult {
  requireQueue(queue).sendNoReply(MSP2.MSP2_SEND_DSHOT_COMMAND, encodeMspSendDshotCommand(commandType, motorIndex, commands))
  return OK
}

// ── OSD (MSP_OSD_CONFIG + character font) ────────────────────

export async function bfGetOsdConfig(queue: MspSerialQueue | null): Promise<MspOsdConfig> {
  return decodeMspOsdConfig(await read(queue, MSP.MSP_OSD_CONFIG))
}

/** Write the OSD config: optional general settings, then each element position. */
export async function bfWriteOsdLayout(
  queue: MspSerialQueue | null,
  items: Array<{ index: number; position: number }>,
  general?: MspOsdGeneralConfig,
): Promise<CommandResult> {
  const q = requireQueue(queue)
  if (general !== undefined) await q.send(MSP.MSP_SET_OSD_CONFIG, encodeMspSetOsdGeneralConfig(general))
  for (const it of items) await q.send(MSP.MSP_SET_OSD_CONFIG, encodeMspSetOsdConfig(it.index, it.position))
  return OK
}

/**
 * Upload a character font: one MSP_OSD_CHAR_WRITE per glyph. Glyphs go
 * straight to the OSD chip's own memory, so no EEPROM write follows.
 */
export async function bfUploadOsdFont(
  queue: MspSerialQueue | null,
  glyphs: Uint8Array[],
  onProgress?: (done: number, total: number) => void,
): Promise<CommandResult> {
  const q = requireQueue(queue)
  for (let i = 0; i < glyphs.length; i++) {
    await q.send(MSP.MSP_OSD_CHAR_WRITE, encodeMspOsdCharWrite(i, glyphs[i]))
    onProgress?.(i + 1, glyphs.length)
  }
  return { success: true, resultCode: 0, message: `Wrote ${glyphs.length} glyphs` }
}

// ── LED strip ────────────────────────────────────────────────

export async function bfGetLedStripConfig(queue: MspSerialQueue | null): Promise<number[]> {
  return decodeMspLedStripConfig(await read(queue, MSP.MSP_LED_STRIP_CONFIG)).leds
}

/** Write the per-LED packed configs (one MSP write per LED, by index). */
export async function bfSetLedStripConfig(queue: MspSerialQueue | null, leds: number[]): Promise<CommandResult> {
  const q = requireQueue(queue)
  for (let i = 0; i < leds.length; i++) {
    await q.send(MSP.MSP_SET_LED_STRIP_CONFIG, encodeMspSetLedStripConfigEntry(i, leds[i]))
  }
  return OK
}

/** Read the 16-entry configurable HSV colour palette (MSP_LED_COLORS 46). */
export async function bfGetLedColors(queue: MspSerialQueue | null): Promise<HsvColor[]> {
  return decodeMspLedColors(await read(queue, MSP.MSP_LED_COLORS))
}

/** Write the full HSV colour palette (MSP_SET_LED_COLORS 47). */
export async function bfSetLedColors(queue: MspSerialQueue | null, colors: HsvColor[]): Promise<CommandResult> {
  await requireQueue(queue).send(MSP.MSP_SET_LED_COLORS, encodeMspSetLedColors(colors))
  return OK
}

/** Read the mode/special/aux colour assignments (MSP_LED_STRIP_MODECOLOR 127). */
export async function bfGetLedStripModeColors(queue: MspSerialQueue | null): Promise<BfLedModeColor[]> {
  return decodeMspLedStripModeColors(await read(queue, MSP.MSP_LED_STRIP_MODECOLOR))
}

/** Set mode colours (one MSP_SET_LED_STRIP_MODECOLOR 221 per entry). */
export async function bfSetLedStripModeColors(queue: MspSerialQueue | null, entries: BfLedModeColor[]): Promise<CommandResult> {
  const q = requireQueue(queue)
  for (const e of entries) {
    await q.send(MSP.MSP_SET_LED_STRIP_MODECOLOR, encodeMspSetLedStripModeColor(e.mode, e.fun, e.color))
  }
  return OK
}

// ── Receiver (MSP_RX_CONFIG / MSP_RX_MAP) ────────────────────

/** Read the receiver config (leading fields + raw payload for round-trip). */
export async function bfGetRxConfig(queue: MspSerialQueue | null): Promise<BfRxConfig> {
  return decodeMspRxConfig(await read(queue, MSP.MSP_RX_CONFIG))
}

/** Write the receiver config (echoes the raw payload with edited fields patched). */
export async function bfSetRxConfig(queue: MspSerialQueue | null, cfg: BfRxConfig): Promise<CommandResult> {
  await requireQueue(queue).send(MSP.MSP_SET_RX_CONFIG, encodeMspSetRxConfig(cfg))
  return OK
}

export async function bfGetRxMap(queue: MspSerialQueue | null): Promise<number[]> {
  return decodeMspRxMap((await requireQueue(queue).send(MSP.MSP_RX_MAP)).payload)
}

export async function bfSetRxMap(queue: MspSerialQueue | null, map: number[]): Promise<CommandResult> {
  await requireQueue(queue).send(MSP.MSP_SET_RX_MAP, encodeMspSetRxMap(map))
  return OK
}

// ── VTX table power levels (MSP_VTXTABLE_POWERLEVEL) ──

/**
 * The VTX table's power levels: `BF_VTX_POWER` is a 1-based index into this
 * table, and each entry carries the label the VTX table assigns it. Empty when
 * the FC has no VTX table.
 */
export async function bfGetVtxPowerLevels(queue: MspSerialQueue | null): Promise<MspVtxTablePowerLevel[]> {
  const config = decodeMspVtxConfig(await read(queue, MSP.MSP_VTX_CONFIG))
  if (!config.vtxTableAvailable) return []
  const levels: MspVtxTablePowerLevel[] = []
  for (let level = 1; level <= config.vtxTablePowerLevels; level++) {
    const p = (await requireQueue(queue).send(MSP.MSP_VTXTABLE_POWERLEVEL, Uint8Array.of(level))).payload
    levels.push(decodeMspVtxTablePowerLevel(new DataView(p.buffer, p.byteOffset, p.byteLength)))
  }
  return levels
}
