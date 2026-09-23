/**
 * iNav mission + safehome + geozone adapter functions.
 *
 * @module protocol/msp-adapter/inav/mission
 */

import type { CommandResult, MissionItem } from '../../types'
import type { MspSerialQueue } from '../../msp/msp-serial-queue'
import { formatErrorMessage } from '@/lib/utils'
import {
  INAV_MSP,
  INAV_LIMITS,
  decodeMspWp,
  decodeMspINavSafehome,
  decodeMspINavGeozone,
  decodeMspINavGeozoneVertex,
  INAV_WP_FLAG_LAST,
  type INavWaypoint,
  type INavSafehome,
  type INavGeozone,
  type INavGeozoneVertex,
} from '../../msp/msp-decoders-inav'
import {
  encodeMspSetWp,
  encodeMspINavSetSafehome,
  encodeMspINavSetGeozone,
  encodeMspINavSetGeozoneVertex,
} from '../../msp/msp-encoders-inav'
import {
  translateToInavWaypoints,
  translateFromInavWaypoints,
} from '@/lib/mission/inav-translator'
import { NOT_CONNECTED, decodeWpGetInfo, dv } from './helpers'

/**
 * Read the mission from the FC. Rejects when not connected or when any frame
 * fails, so a partial or failed read never stands in for the FC's mission; an
 * FC that holds no mission resolves `[]`.
 */
export async function inavDownloadMission(
  queue: MspSerialQueue | null,
  missionIndex = 0,
): Promise<MissionItem[]> {
  if (!queue) throw new Error(NOT_CONNECTED.message)
  // Switch multi-mission slot if requested
  if (missionIndex > 0) {
    const loadPayload = new Uint8Array([missionIndex])
    await queue.send(INAV_MSP.MSP_WP_MISSION_LOAD, loadPayload)
  }

  // Query how many WPs are loaded
  const infoFrame = await queue.send(INAV_MSP.MSP_WP_GETINFO)
  const { waypointCount } = decodeWpGetInfo(infoFrame.payload)
  if (waypointCount === 0) return []

  const waypoints: INavWaypoint[] = []
  for (let i = 0; i < waypointCount; i++) {
    const reqPayload = new Uint8Array([i + 1]) // WP numbers are 1-based
    const frame = await queue.send(INAV_MSP.MSP_WP, reqPayload)
    const dv = new DataView(frame.payload.buffer, frame.payload.byteOffset, frame.payload.byteLength)
    waypoints.push(decodeMspWp(dv))
  }

  return translateFromInavWaypoints(waypoints)
}

// ── Mission upload ───────────────────────────────────────────

/**
 * Upload a mission to the FC via MSP_SET_WP.
 *
 * Optionally saves to multi-mission slot via MSP_WP_MISSION_SAVE.
 */
export async function inavUploadMission(
  queue: MspSerialQueue | null,
  items: MissionItem[],
  missionIndex = 0,
): Promise<CommandResult> {
  if (!queue) return NOT_CONNECTED
  if (items.length === 0) return { success: true, resultCode: 0, message: 'No waypoints to upload' }
  try {
    const waypoints = translateToInavWaypoints(items)

    // Ensure last WP is marked
    if (waypoints.length > 0) {
      waypoints[waypoints.length - 1].flag = INAV_WP_FLAG_LAST
    }

    for (const wp of waypoints) {
      const payload = encodeMspSetWp(wp)
      await queue.send(INAV_MSP.MSP_SET_WP, payload)
    }

    // Save to EEPROM / multi-mission slot
    const savePayload = new Uint8Array([missionIndex])
    await queue.send(INAV_MSP.MSP_WP_MISSION_SAVE, savePayload)

    return { success: true, resultCode: 0, message: `Uploaded ${items.length} waypoints` }
  } catch (err) {
    return { success: false, resultCode: -1, message: `Mission upload failed: ${formatErrorMessage(err)}` }
  }
}

// ── Safehome download ─────────────────────────────────────────

/**
 * Download every safehome slot the FC has (MAX_SAFE_HOMES). Disabled slots
 * come back with enabled=false. Any failed frame fails the download, so a
 * partial read never stands in for the FC's table.
 */
export async function inavDownloadSafehomes(
  queue: MspSerialQueue | null,
): Promise<INavSafehome[]> {
  if (!queue) throw new Error('Not connected')
  const results: INavSafehome[] = []
  for (let i = 0; i < INAV_LIMITS.SAFEHOMES; i++) {
    const frame = await queue.send(INAV_MSP.MSP2_INAV_SAFEHOME, new Uint8Array([i]))
    results.push(decodeMspINavSafehome(dv(frame.payload)))
  }
  return results
}

// ── Safehome upload ───────────────────────────────────────────

/**
 * Write every safehome slot the FC has. Slots past the provided list are
 * written disabled. A failure part-way names the slots that did change.
 */
export async function inavUploadSafehomes(
  queue: MspSerialQueue | null,
  safehomes: INavSafehome[],
): Promise<CommandResult> {
  if (!queue) return NOT_CONNECTED
  if (safehomes.length > INAV_LIMITS.SAFEHOMES) {
    return { success: false, resultCode: -1, message: `This flight controller has ${INAV_LIMITS.SAFEHOMES} safehome slots; ${safehomes.length} do not fit` }
  }
  for (let i = 0; i < INAV_LIMITS.SAFEHOMES; i++) {
    const sh = { ...(safehomes[i] ?? { enabled: false, lat: 0, lon: 0 }), index: i }
    try {
      await queue.send(INAV_MSP.MSP2_INAV_SET_SAFEHOME, encodeMspINavSetSafehome(sh))
    } catch (err) {
      const written = i === 0 ? 'no slots were written' : `slots 0-${i - 1} were written`
      return { success: false, resultCode: -1, message: `Safehome slot ${i} failed (${formatErrorMessage(err)}); ${written}` }
    }
  }
  return { success: true, resultCode: 0, message: `Wrote ${INAV_LIMITS.SAFEHOMES} safehome slots` }
}

// ── Geozone download ──────────────────────────────────────────

/** iNav geozone shape value for a circle (centre vertex plus radius). */
const GEOZONE_SHAPE_CIRCULAR = 0

/**
 * Download every configured geozone and its vertices. A slot with no vertices
 * is unused and is skipped. A circular zone is read as its centre vertex,
 * whose reply carries the radius. Any failed frame fails the whole download,
 * so a partial read never stands in for the FC's zones.
 */
export async function inavDownloadGeozones(
  queue: MspSerialQueue | null,
): Promise<{ zones: INavGeozone[]; vertices: INavGeozoneVertex[] }> {
  if (!queue) return { zones: [], vertices: [] }
  const zones: INavGeozone[] = []
  const vertices: INavGeozoneVertex[] = []
  for (let i = 0; i < INAV_LIMITS.GEOZONES; i++) {
    const zoneFrame = await queue.send(INAV_MSP.MSP2_INAV_GEOZONE, new Uint8Array([i]))
    const zone = decodeMspINavGeozone(new DataView(zoneFrame.payload.buffer, zoneFrame.payload.byteOffset, zoneFrame.payload.byteLength))
    if (zone.vertexCount === 0) continue
    zones.push(zone)

    const fetchCount = zone.shape === GEOZONE_SHAPE_CIRCULAR ? 1 : zone.vertexCount
    for (let v = 0; v < fetchCount; v++) {
      const vFrame = await queue.send(INAV_MSP.MSP2_INAV_GEOZONE_VERTEX, new Uint8Array([i, v]))
      vertices.push(decodeMspINavGeozoneVertex(new DataView(vFrame.payload.buffer, vFrame.payload.byteOffset, vFrame.payload.byteLength)))
    }
  }
  return { zones, vertices }
}

// ── Geozone upload ────────────────────────────────────────────

/** Frame that clears a geozone slot: no vertices, so the FC treats it as unused. */
function emptyGeozone(number: number): INavGeozone {
  return { number, type: 0, shape: 0, minAlt: 0, maxAlt: 0, isSeaLevelRef: false, fenceAction: 0, vertexCount: 0 }
}

/**
 * Write every geozone slot the FC has. Each zone frame resets that zone's
 * vertices on the FC, so its vertices follow it; a circular zone sends only
 * its centre vertex, which carries the radius. Slots with no zone get an empty
 * frame, so a zone deleted or renumbered in the editor cannot keep its old
 * geometry on the FC.
 */
export async function inavUploadGeozones(
  queue: MspSerialQueue | null,
  zones: INavGeozone[],
  vertices: INavGeozoneVertex[],
): Promise<CommandResult> {
  if (!queue) return NOT_CONNECTED
  const outOfRange = zones.find((z) => z.number < 0 || z.number >= INAV_LIMITS.GEOZONES)
  if (outOfRange) {
    return { success: false, resultCode: -1, message: `Geozone ${outOfRange.number} is outside the ${INAV_LIMITS.GEOZONES} slots this flight controller has` }
  }
  const bySlot = new Map(zones.map((z) => [z.number, z]))
  try {
    for (let slot = 0; slot < INAV_LIMITS.GEOZONES; slot++) {
      const zone = bySlot.get(slot)
      if (!zone) {
        await queue.send(INAV_MSP.MSP2_INAV_SET_GEOZONE, encodeMspINavSetGeozone(emptyGeozone(slot)))
        continue
      }
      await queue.send(INAV_MSP.MSP2_INAV_SET_GEOZONE, encodeMspINavSetGeozone(zone))
      const zoneVerts = vertices.filter((v) => v.geozoneId === zone.number)
      const toSend = zone.shape === GEOZONE_SHAPE_CIRCULAR ? zoneVerts.slice(0, 1) : zoneVerts
      for (const vert of toSend) {
        await queue.send(INAV_MSP.MSP2_INAV_SET_GEOZONE_VERTEX, encodeMspINavSetGeozoneVertex(vert))
      }
    }
    return { success: true, resultCode: 0, message: `Uploaded ${zones.length} geozones` }
  } catch (err) {
    return { success: false, resultCode: -1, message: `Geozone upload failed: ${formatErrorMessage(err)}` }
  }
}

// ── Battery config ────────────────────────────────────────────

