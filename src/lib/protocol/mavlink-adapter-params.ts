/**
 * MAVLink adapter — parameter protocol methods.
 *
 * getAllParameters, getParameter, setParameter, getCachedParameterNames,
 * and the parameter download state machine helpers.
 *
 * @module protocol/mavlink-adapter-params
 */

import type { Transport, ParameterValue, CommandResult, FirmwareHandler, ParameterCallback } from './types'
import { encodeParamRequestList, encodeParamRequestRead, encodeParamSet } from './mavlink-encoder'

/**
 * A cached parameter read. Stores the full MAV_PARAM shape so a cache-served
 * read returns the param's real type/index/count rather than a hardcoded
 * REAL32/-1/-1. index/count are -1 when the entry was written from a targeted
 * read whose source frame did not carry them.
 */
export interface ParamCacheEntry {
  value: number
  timestamp: number
  type: number
  index: number
  count: number
}

/**
 * Rejected by getParameter when the full parameter list has been downloaded and
 * the requested name is not in it — i.e. this board does not have the param.
 * Distinct from a timeout so callers can treat it as "absent" (skip retries,
 * don't surface as an error) rather than a transient failure worth retrying.
 */
export class ParamAbsentError extends Error {
  readonly code = 'param_absent' as const
  constructor(name: string) {
    super(`Parameter not present on this board: ${name}`)
    this.name = 'ParamAbsentError'
  }
}

export interface ParamDownloadState {
  params: Map<number, ParameterValue>
  total: number
  /**
   * One entry per caller awaiting this download. `getAllParameters` piggybacks
   * a second concurrent call onto the SAME in-flight download instead of
   * starting a competing one (see the re-entrancy guard there) — every
   * resolver fires with the identical final list when it finishes.
   */
  resolvers: Array<(params: ParameterValue[]) => void>
  hardTimer: ReturnType<typeof setTimeout>
  inactivityTimer: ReturnType<typeof setTimeout> | null
  retryCount: number
  /** Missing-index count as of the last retry round, so a round that makes no
   * progress can be told apart from one that is still genuinely converging. */
  lastMissingCount: number
  /** Consecutive retry rounds that made no progress. Distinct from
   * `retryCount` (which just counts rounds) — this is what decides when to
   * give up, so a lossy link that is slowly-but-really converging keeps
   * getting retried instead of stopping at an arbitrary round count. */
  noProgressRounds: number
  resetInactivityTimer: () => void
}

export interface ParamContext {
  transport: Transport | null
  firmwareHandler: FirmwareHandler | null
  targetSysId: number
  targetCompId: number
  sysId: number
  compId: number
  paramCache: Map<string, ParamCacheEntry>
  PARAM_CACHE_TTL_MS: number
  parameterDownload: ParamDownloadState | null
  /**
   * The authoritative set of parameter names this board reported in the last
   * COMPLETE full download (null until one completes; cleared on disconnect).
   * Used to fast-fail a read for a param the board does not have. Not mutated
   * by setParameter, so it stays a stable "which params exist" oracle.
   */
  downloadedParamNames: Set<string> | null
  onParameter: (cb: ParameterCallback) => () => void
}

export function finishParamDownload(ctx: ParamContext): void {
  if (!ctx.parameterDownload) return
  const dl = ctx.parameterDownload
  clearTimeout(dl.hardTimer)
  if (dl.inactivityTimer) clearTimeout(dl.inactivityTimer)
  const params = Array.from(dl.params.values()).sort((a, b) => a.index - b.index)
  for (const resolve of dl.resolvers) resolve(params)
  ctx.parameterDownload = null
}

export function retryMissingParams(ctx: ParamContext): void {
  if (!ctx.parameterDownload || !ctx.transport?.isConnected) return
  const dl = ctx.parameterDownload

  if (dl.total <= 0) {
    dl.retryCount++
    if (dl.retryCount % 2 === 0) {
      ctx.transport!.send(encodeParamRequestList(ctx.targetSysId, ctx.targetCompId, ctx.sysId, ctx.compId))
    }
    dl.resetInactivityTimer()
    return
  }

  const missing: number[] = []
  for (let i = 0; i < dl.total; i++) {
    if (!dl.params.has(i)) missing.push(i)
  }

  if (missing.length === 0) {
    finishParamDownload(ctx)
    return
  }

  // Keep retrying as long as each round is genuinely converging (fewer
  // missing than the round before); only give up once a round in a row
  // gains nothing. A fixed retry-round cap gave up on a lossy link that was
  // still slowly closing the gap well before the 120s hard timeout that
  // already bounds the whole download regardless.
  if (missing.length >= dl.lastMissingCount) {
    dl.noProgressRounds++
  } else {
    dl.noProgressRounds = 0
  }
  dl.lastMissingCount = missing.length
  dl.retryCount++
  if (dl.noProgressRounds >= 6) {
    finishParamDownload(ctx)
    return
  }

  const batch = missing.slice(0, 50)
  for (const idx of batch) {
    ctx.transport!.send(
      encodeParamRequestRead(
        ctx.targetSysId, ctx.targetCompId,
        '', idx, ctx.sysId, ctx.compId,
      )
    )
  }
  dl.resetInactivityTimer()
}

export async function getAllParameters(ctx: ParamContext): Promise<ParameterValue[]> {
  if (!ctx.transport?.isConnected) throw new Error('Not connected')

  // A download is already in flight on this connection — share it instead of
  // starting a second one. Two independent ParamDownloadState objects would
  // both exist, but only the newest one keeps receiving incoming PARAM_VALUE
  // frames (frame routing always reads the live, current download state), so
  // starting a second download silently abandons the first caller's promise
  // until its own now-orphaned 120s hard timer eventually resolves it with a
  // stale, likely-incomplete list. Piggybacking is what actually shares one
  // real download between callers.
  if (ctx.parameterDownload) {
    const dl = ctx.parameterDownload
    return new Promise<ParameterValue[]>((resolve) => {
      dl.resolvers.push(resolve)
    })
  }

  return new Promise<ParameterValue[]>((resolve) => {
    const hardTimer = setTimeout(() => {
      if (ctx.parameterDownload) {
        finishParamDownload(ctx)
      }
    }, 120000)

    const createInactivityTimer = (): ReturnType<typeof setTimeout> => {
      return setTimeout(() => {
        retryMissingParams(ctx)
      }, 5000)
    }

    const resetInactivityTimer = () => {
      if (ctx.parameterDownload?.inactivityTimer) {
        clearTimeout(ctx.parameterDownload.inactivityTimer)
      }
      if (ctx.parameterDownload) {
        ctx.parameterDownload.inactivityTimer = createInactivityTimer()
      }
    }

    ctx.parameterDownload = {
      params: new Map(),
      total: 0,
      resolvers: [resolve],
      hardTimer,
      inactivityTimer: createInactivityTimer(),
      retryCount: 0,
      lastMissingCount: Infinity,
      noProgressRounds: 0,
      resetInactivityTimer,
    }

    ctx.transport!.send(encodeParamRequestList(ctx.targetSysId, ctx.targetCompId, ctx.sysId, ctx.compId))
  })
}

export function getCachedParameterNames(ctx: ParamContext): string[] {
  return Array.from(ctx.paramCache.keys())
}

export async function getParameter(ctx: ParamContext, name: string): Promise<ParameterValue> {
  if (!ctx.transport?.isConnected) {
    return Promise.reject(new Error('Not connected'))
  }

  const firmwareName = ctx.firmwareHandler?.mapParameterName(name) ?? name

  const cached = ctx.paramCache.get(name)
  if (cached && (Date.now() - cached.timestamp) < ctx.PARAM_CACHE_TTL_MS) {
    return { name, value: cached.value, type: cached.type, index: cached.index, count: cached.count }
  }

  // Fast-fail a param the board doesn't have. Once the full list has been
  // downloaded we know exactly which params exist; a name outside that set can
  // never answer PARAM_REQUEST_READ, so reject immediately instead of waiting
  // out the 5s timeout (× the caller's retries). Before the list completes
  // (downloadedParamNames === null) fall through to a normal live read.
  if (ctx.downloadedParamNames && !ctx.downloadedParamNames.has(name) && !ctx.downloadedParamNames.has(firmwareName)) {
    return Promise.reject(new ParamAbsentError(name))
  }

  return new Promise<ParameterValue>((resolve, reject) => {
    const timer = setTimeout(() => {
      unsub()
      reject(new Error(`getParameter timed out: ${name}`))
    }, 5000)

    const unsub = ctx.onParameter((param) => {
      if (param.name === firmwareName) {
        clearTimeout(timer)
        unsub()
        ctx.paramCache.set(name, { value: param.value, timestamp: Date.now(), type: param.type, index: param.index, count: param.count })
        resolve({ ...param, name })
      }
    })

    ctx.transport!.send(encodeParamRequestRead(
      ctx.targetSysId, ctx.targetCompId,
      firmwareName, -1, ctx.sysId, ctx.compId,
    ))
  })
}

/**
 * Attempts for one PARAM_SET before reporting failure, and the gap between
 * them. MAVLink's parameter protocol puts retransmission on the GCS: the
 * vehicle answers a write with a PARAM_VALUE echo and nothing else, so a
 * dropped write is indistinguishable from a slow one until the GCS resends.
 * Reporting a hard failure on the first miss made a single lost frame look
 * like a rejected write.
 */
const PARAM_SET_ATTEMPTS = 3
const PARAM_SET_ATTEMPT_MS = 1000

export async function setParameter(ctx: ParamContext, name: string, value: number, type = 9): Promise<CommandResult> {
  if (!ctx.transport?.isConnected) return { success: false, resultCode: -1, message: 'Not connected' }

  const firmwareName = ctx.firmwareHandler?.mapParameterName(name) ?? name
  ctx.paramCache.delete(name)

  // PX4 integer params need byte-wise encoding
  let encodedValue = value
  if (ctx.firmwareHandler?.firmwareType === 'px4' && type !== 9) {
    const tmp = new DataView(new ArrayBuffer(4))
    tmp.setInt32(0, Math.round(value), true)
    encodedValue = tmp.getFloat32(0, true)
  }

  return new Promise<CommandResult>((resolve) => {
    let attempt = 0
    let timer: ReturnType<typeof setTimeout>

    // One subscription for the whole exchange, released on EVERY exit path.
    // The timeout path used to resolve without unsubscribing, so each timed-out
    // write left a permanent callback still writing paramCache for that name —
    // one leaked subscriber per failed write, and a bulk panel save on a lossy
    // link leaks one per parameter.
    const unsub = ctx.onParameter((param) => {
      if (param.name !== firmwareName) return
      clearTimeout(timer)
      unsub()
      ctx.paramCache.set(name, { value: param.value, timestamp: Date.now(), type: param.type, index: param.index, count: param.count })
      resolve({
        success: Math.abs(param.value - value) < 0.001,
        resultCode: 0,
        message: `Parameter ${name} = ${param.value}`,
      })
    })

    const attemptWrite = () => {
      attempt += 1
      try {
        ctx.transport!.send(encodeParamSet(ctx.targetSysId, ctx.targetCompId, firmwareName, encodedValue, type, ctx.sysId, ctx.compId))
      } catch (err) {
        unsub()
        resolve({
          success: false,
          resultCode: -1,
          message: `Param set failed: ${err instanceof Error ? err.message : String(err)}`,
        })
        return
      }
      timer = setTimeout(() => {
        if (attempt < PARAM_SET_ATTEMPTS) {
          attemptWrite()
          return
        }
        unsub()
        resolve({
          success: false,
          resultCode: -1,
          message: `Param set timed out after ${attempt} attempts: ${name}`,
        })
      }, PARAM_SET_ATTEMPT_MS)
    }

    attemptWrite()
  })
}
