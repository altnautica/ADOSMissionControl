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
import { NOT_CONNECTED, SAFEHOME_COUNT, GEOZONE_COUNT, decodeWpGetInfo } from './helpers'

export async function inavDownloadMission(
  queue: MspSerialQueue | null,
  missionIndex = 0,
): Promise<MissionItem[]> {
  if (!queue) return []
  try {
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
  } catch (err) {
    console.warn('Mission download failed:', formatErrorMessage(err))
    return []
  }
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

/** Maximum safehome slots in iNav. */

/**
 * Download all safehome slots (0-15) from the FC.
 * Returns all 16 slots; disabled slots have enabled=false.
 */
export async function inavDownloadSafehomes(
  queue: MspSerialQueue | null,
): Promise<INavSafehome[]> {
  if (!queue) return []
  const results: INavSafehome[] = []
  try {
    for (let i = 0; i < SAFEHOME_COUNT; i++) {
      const payload = new Uint8Array([i])
      const frame = await queue.send(INAV_MSP.MSP2_INAV_SAFEHOME, payload)
      const dv = new DataView(frame.payload.buffer, frame.payload.byteOffset, frame.payload.byteLength)
      results.push(decodeMspINavSafehome(dv))
    }
    return results
  } catch (err) {
    console.warn('Safehome download failed:', formatErrorMessage(err))
    return results
  }
}

// ── Safehome upload ───────────────────────────────────────────

/**
 * Upload all 16 safehome slots to the FC.
 * If fewer than 16 are provided the remaining slots are padded with disabled entries.
 */
export async function inavUploadSafehomes(
  queue: MspSerialQueue | null,
  safehomes: INavSafehome[],
): Promise<CommandResult> {
  if (!queue) return NOT_CONNECTED
  try {
    // Pad to 16 with disabled slots
    const slots: INavSafehome[] = Array.from({ length: SAFEHOME_COUNT }, (_, i) => {
      return safehomes[i] ?? { index: i, enabled: false, lat: 0, lon: 0 }
    })

    for (let i = 0; i < SAFEHOME_COUNT; i++) {
      const sh = { ...slots[i], index: i }
      const payload = encodeMspINavSetSafehome(sh)
      await queue.send(INAV_MSP.MSP2_INAV_SET_SAFEHOME, payload)
    }

    return { success: true, resultCode: 0, message: `Uploaded ${SAFEHOME_COUNT} safehome slots` }
  } catch (err) {
    return { success: false, resultCode: -1, message: `Safehome upload failed: ${formatErrorMessage(err)}` }
  }
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
  for (let i = 0; i < GEOZONE_COUNT; i++) {
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

/**
 * Upload zones and their vertices to the FC. Each zone frame resets that
 * zone's vertices on the FC, so its vertices follow it. A circular zone sends
 * only its centre vertex, which carries the radius.
 */
export async function inavUploadGeozones(
  queue: MspSerialQueue | null,
  zones: INavGeozone[],
  vertices: INavGeozoneVertex[],
): Promise<CommandResult> {
  if (!queue) return NOT_CONNECTED
  if (zones.length > GEOZONE_COUNT) {
    return { success: false, resultCode: -1, message: `Maximum ${GEOZONE_COUNT} geozones supported` }
  }
  try {
    for (const zone of zones) {
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

