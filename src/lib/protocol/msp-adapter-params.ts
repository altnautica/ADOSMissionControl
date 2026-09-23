/**
 * MSP adapter — virtual parameter system.
 *
 * MSP doesn't have named parameters. This module resolves the named
 * virtual parameters of `msp/virtual-params` (the single registry) against
 * MSP config payloads, and iNav's lowercase named settings through the
 * settings client.
 *
 * @module protocol/msp-adapter-params
 */

import type { ParameterValue, ParameterCallback, CommandResult } from './types'
import { formatErrorMessage } from '@/lib/utils'
import type { MspSerialQueue } from './msp/msp-serial-queue'
import type { SettingsClient } from './msp/settings'
import { VIRTUAL_PARAMS, getParamsByReadCmd, type VirtualParamDef } from './msp/virtual-params'
import { toWritePayload } from './msp/virtual-params/write-layouts'
import { MAV_PARAM_TYPE } from './param-value-codec'

const NOT_CONNECTED: CommandResult = {
  success: false, resultCode: -1, message: 'Not connected',
}

/** Registry value type → MAV_PARAM_TYPE for the grid's type column. */
const MAV_TYPE_BY_VIRTUAL_TYPE: Record<VirtualParamDef['type'], number> = {
  uint8: MAV_PARAM_TYPE.UINT8,
  uint16: MAV_PARAM_TYPE.UINT16,
  int16: MAV_PARAM_TYPE.INT16,
  uint32: MAV_PARAM_TYPE.UINT32,
  float: MAV_PARAM_TYPE.REAL32,
}

/** Registry names in a fixed order, so indices are stable across reads. */
const VIRTUAL_PARAM_NAMES = Array.from(VIRTUAL_PARAMS.keys())

/** Map an iNav setting_type_e (VAR_UINT8=0 .. VAR_FLOAT=5, VAR_STRING=6) to a
 * MAV_PARAM_TYPE for the grid's type column. */
export function inavTypeToMavType(t: number): number {
  switch (t) {
    case 0: return MAV_PARAM_TYPE.UINT8
    case 1: return MAV_PARAM_TYPE.INT8
    case 2: return MAV_PARAM_TYPE.UINT16
    case 3: return MAV_PARAM_TYPE.INT16
    case 4: return MAV_PARAM_TYPE.UINT32
    default: return MAV_PARAM_TYPE.REAL32
  }
}

const VALID_SETTING_NAME = /^[a-z][a-z0-9_]+$/

export interface MspParamContext {
  queue: MspSerialQueue | null
  paramCache: Map<number, Uint8Array>
  paramNameCache: string[]
  parameterCallbacks: ParameterCallback[]
  /** iNav named-settings client (present once connected). */
  settingsClient?: SettingsClient | null
  /** True when the connected FC runs iNav (enables the named-settings list). */
  isInav?: boolean
}

/**
 * Enumerate iNav's full named-settings list (firmware-verified by-index decode),
 * returning a parameter list — or null to fall back to the virtual-param list.
 * Sanity-gated so a wrong decode can never surface garbage: the count must be
 * plausible and a sample of names must be valid iNav identifiers.
 */
async function tryEnumerateInavSettings(client: SettingsClient): Promise<ParameterValue[] | null> {
  let settings
  try {
    settings = await client.enumerateAllSettings()
  } catch {
    return null
  }
  if (settings.length < 100 || settings.length > 2000) return null
  const sample = settings.slice(0, 25)
  if (!sample.every((s) => VALID_SETTING_NAME.test(s.name))) return null
  const count = settings.length
  return settings.map((s, i) => ({
    name: s.name,
    value: typeof s.value === 'number' && Number.isFinite(s.value) ? s.value : 0,
    type: inavTypeToMavType(s.type),
    index: i,
    count,
  }))
}

export async function mspGetAllParameters(ctx: MspParamContext): Promise<ParameterValue[]> {
  if (!ctx.queue) return []

  // iNav: surface the full named-settings list. Sanity-gated; on any failure
  // this returns null and we fall through to the virtual-param registry.
  if (ctx.isInav && ctx.settingsClient) {
    const named = await tryEnumerateInavSettings(ctx.settingsClient)
    if (named) {
      ctx.paramNameCache = named.map((p) => p.name)
      for (const param of named) {
        for (const cb of ctx.parameterCallbacks) cb(param)
      }
      return named
    }
  }

  for (const cmd of getParamsByReadCmd().keys()) {
    try {
      const frame = await ctx.queue.send(cmd)
      ctx.paramCache.set(cmd, frame.payload)
    } catch {
      // The firmware does not answer this block; its params stay absent.
    }
  }

  const results = buildVirtualParams(ctx.paramCache)
  ctx.paramNameCache = results.map(p => p.name)
  for (const param of results) {
    for (const cb of ctx.parameterCallbacks) cb(param)
  }
  return results
}

export async function mspGetParameter(ctx: MspParamContext, name: string): Promise<ParameterValue> {
  if (!ctx.queue) throw new Error('Not connected')
  const def = VIRTUAL_PARAMS.get(name)
  if (!def) {
    // iNav named setting (lowercase) — read via the settings client. The
    // SETTING_INFO response carries the current value, so one round-trip.
    if (ctx.isInav && ctx.settingsClient) {
      const info = await ctx.settingsClient.getInfo(name)
      return {
        name,
        value: typeof info.value === 'number' && Number.isFinite(info.value) ? info.value : 0,
        type: inavTypeToMavType(info.type),
        index: info.index,
        count: ctx.paramNameCache.length || 1,
      }
    }
    throw new Error(`Unknown parameter: ${name}`)
  }

  let payload = ctx.paramCache.get(def.readCmd)
  if (!payload) {
    const frame = await ctx.queue.send(def.readCmd)
    payload = frame.payload
    ctx.paramCache.set(def.readCmd, payload)
  }
  if (payload.length < def.readEnd) {
    throw new Error(`${name} is not reported by this firmware version`)
  }

  return {
    name, value: def.decode(payload), type: MAV_TYPE_BY_VIRTUAL_TYPE[def.type],
    index: VIRTUAL_PARAM_NAMES.indexOf(name),
    count: ctx.paramNameCache.length || VIRTUAL_PARAM_NAMES.length,
  }
}

export async function mspSetParameter(ctx: MspParamContext, name: string, value: number): Promise<CommandResult> {
  if (!ctx.queue) return NOT_CONNECTED
  const def = VIRTUAL_PARAMS.get(name)
  if (!def) {
    // iNav named setting — write via the settings client (fetches the type then
    // encodes + MSP2_COMMON_SET_SETTING).
    if (ctx.isInav && ctx.settingsClient) {
      try {
        await ctx.settingsClient.set(name, value)
        return { success: true, resultCode: 0, message: 'OK' }
      } catch (err) {
        return { success: false, resultCode: -1, message: `Write failed: ${formatErrorMessage(err)}` }
      }
    }
    return { success: false, resultCode: -1, message: `Unknown parameter: ${name}` }
  }
  if (def.readOnly) {
    return { success: false, resultCode: -1, message: `${name} is reported by the flight controller and cannot be written` }
  }

  // Always start from a fresh read: the write carries the whole config block,
  // so a stale copy would put back values changed elsewhere since.
  let current: Uint8Array
  try {
    current = (await ctx.queue.send(def.readCmd)).payload
  } catch (err) {
    ctx.paramCache.delete(def.readCmd)
    return { success: false, resultCode: -1, message: `Read failed: ${formatErrorMessage(err)}` }
  }
  ctx.paramCache.set(def.readCmd, current)
  if (current.length < def.readEnd) {
    return { success: false, resultCode: -1, message: `${name} is not reported by this firmware version` }
  }

  try {
    await ctx.queue.send(def.writeCmd, def.encode(value, toWritePayload(def.readCmd, current)))
  } catch (err) {
    return { success: false, resultCode: -1, message: `Write failed: ${formatErrorMessage(err)}` }
  } finally {
    // The block changed (or may have); the next read fetches it again.
    ctx.paramCache.delete(def.readCmd)
  }
  return { success: true, resultCode: 0, message: 'OK' }
}

function buildVirtualParams(paramCache: Map<number, Uint8Array>): ParameterValue[] {
  const results: ParameterValue[] = []
  const total = VIRTUAL_PARAM_NAMES.length
  VIRTUAL_PARAM_NAMES.forEach((name, index) => {
    const def = VIRTUAL_PARAMS.get(name)
    const payload = def && paramCache.get(def.readCmd)
    if (!def || !payload || payload.length < def.readEnd) return
    results.push({ name, value: def.decode(payload), type: MAV_TYPE_BY_VIRTUAL_TYPE[def.type], index, count: total })
  })
  return results
}
