/**
 * Translation between MissionItem (MAVLink wire format) and INavWaypoint (MSP format).
 *
 * MissionItem uses MAV_CMD command codes with x/y/z for lat*1e7/lon*1e7/alt-meters.
 * INavWaypoint uses iNav action codes with lat/lon as float degrees and altitude in cm.
 *
 * Every MissionItem maps to exactly one iNav waypoint or the upload is refused:
 * a command with no iNav equivalent throws, naming the command, rather than
 * becoming a WAYPOINT at whatever x/y it carried (0,0 for a DO command).
 *
 * iNav `p3` bit 0 selects the altitude datum (1 = AMSL, 0 = above home). It is
 * derived from the item frame; a terrain-relative item has no iNav datum and is
 * refused.
 *
 * iNav has no speed-change item: a WAYPOINT or LAND carries the speed of the
 * leg into it in `p1`, a POSHOLD_TIME in `p2` (cm/s; under 50 = the mission
 * default). A DO_CHANGE_SPEED item is therefore folded into every following
 * speed slot until the next change, and DO_JUMP targets are renumbered to
 * account for the removed items. A download turns each speed change back into
 * a DO_CHANGE_SPEED item ahead of the waypoint that sets it.
 *
 * @module mission/inav-translator
 */

import type { MissionItem } from '@/lib/protocol/types'
import {
  INAV_WP_ACTION,
  INAV_WP_FLAG_LAST,
  type INavWaypoint,
} from '@/lib/protocol/msp/msp-decoders-inav'
import {
  MAV_FRAME_GLOBAL,
  MAV_FRAME_GLOBAL_INT,
  MAV_FRAME_GLOBAL_RELATIVE_ALT,
  MAV_FRAME_GLOBAL_RELATIVE_ALT_INT,
} from '@/lib/mission/altitude-frame'
import { missionCommandName, speedItem } from '@/lib/mission/mission-expand'

// MAV_CMD constants used in translation
const MAV_CMD_NAV_WAYPOINT     = 16
const MAV_CMD_NAV_LOITER_UNLIM = 17
const MAV_CMD_NAV_LOITER_TIME  = 19
const MAV_CMD_NAV_RETURN_TO_LAUNCH = 20
const MAV_CMD_NAV_LAND         = 21
const MAV_CMD_NAV_TAKEOFF      = 22
const MAV_CMD_CONDITION_YAW    = 115
const MAV_CMD_DO_JUMP          = 177
const MAV_CMD_DO_CHANGE_SPEED  = 178
const MAV_CMD_DO_SET_ROI       = 201

/** Smallest per-waypoint speed (cm/s) iNav honours; lower flies the default. */
const INAV_MIN_WP_SPEED_CMS = 50

/** iNav firmware hard limit on waypoints per mission. */
export const INAV_MAX_WAYPOINTS = 60

/** iNav `p3` bit 0 for an item's frame: 1 = AMSL, 0 = above home. */
function altitudeDatumBit(item: MissionItem, number: number): number {
  switch (item.frame) {
    case MAV_FRAME_GLOBAL:
    case MAV_FRAME_GLOBAL_INT:
      return 1
    case MAV_FRAME_GLOBAL_RELATIVE_ALT:
    case MAV_FRAME_GLOBAL_RELATIVE_ALT_INT:
      return 0
    default:
      throw new Error(
        `iNav waypoint ${number} (${missionCommandName(item.command)}) uses MAV_FRAME ${item.frame}; iNav supports only above-home or sea-level altitudes.`,
      )
  }
}

/** The iNav action, p1, p2 and p3 for one MissionItem. */
function toInavAction(
  item: MissionItem,
  number: number,
  speedCmS: number,
  jumpTargetNumber: (seq: number) => number,
): Pick<INavWaypoint, 'action' | 'p1' | 'p2' | 'p3'> {
  switch (item.command) {
    case MAV_CMD_NAV_TAKEOFF:
      // iNav starts a mission airborne; the takeoff point is flown as a waypoint.
      return { action: INAV_WP_ACTION.WAYPOINT, p1: speedCmS, p2: 0, p3: altitudeDatumBit(item, number) }
    case MAV_CMD_NAV_WAYPOINT: {
      // MAVLink param1 is a hold time. iNav WAYPOINT p1 is a leg speed, so a
      // held waypoint becomes a timed position hold (speed in p2).
      const hold = Math.round(item.param1)
      return hold > 0
        ? { action: INAV_WP_ACTION.POSHOLD_TIME, p1: hold, p2: speedCmS, p3: altitudeDatumBit(item, number) }
        : { action: INAV_WP_ACTION.WAYPOINT, p1: speedCmS, p2: 0, p3: altitudeDatumBit(item, number) }
    }
    case MAV_CMD_NAV_LOITER_UNLIM:
      return { action: INAV_WP_ACTION.POSHOLD_UNLIM, p1: 0, p2: 0, p3: altitudeDatumBit(item, number) }
    case MAV_CMD_NAV_LOITER_TIME:
      return { action: INAV_WP_ACTION.POSHOLD_TIME, p1: Math.round(item.param1), p2: speedCmS, p3: altitudeDatumBit(item, number) }
    case MAV_CMD_NAV_RETURN_TO_LAUNCH:
      // MAVLink RTL returns and lands; iNav RTH lands only when p1 is set.
      return { action: INAV_WP_ACTION.RTH, p1: 1, p2: 0, p3: 0 }
    case MAV_CMD_NAV_LAND:
      // p1 is the approach speed; p2 is the landing-site elevation (metres)
      // in the same datum as the waypoint.
      return { action: INAV_WP_ACTION.LAND, p1: speedCmS, p2: Math.round(item.param2), p3: altitudeDatumBit(item, number) }
    case MAV_CMD_DO_JUMP:
      return { action: INAV_WP_ACTION.JUMP, p1: jumpTargetNumber(Math.round(item.param1)), p2: Math.round(item.param2), p3: 0 }
    case MAV_CMD_DO_SET_ROI:
      return { action: INAV_WP_ACTION.SET_POI, p1: 0, p2: 0, p3: altitudeDatumBit(item, number) }
    case MAV_CMD_CONDITION_YAW:
      return { action: INAV_WP_ACTION.SET_HEAD, p1: Math.round(item.param1), p2: 0, p3: 0 }
    default:
      throw new Error(
        `iNav has no equivalent for mission command ${missionCommandName(item.command)} (waypoint ${number}). Remove it before uploading to iNav.`,
      )
  }
}

/**
 * Convert an array of MissionItems into iNav waypoints.
 *
 * The last waypoint in the array is flagged with INAV_WP_FLAG_LAST (0xA5).
 * Index numbers are 1-based per the iNav MSP_WP protocol.
 *
 * Altitude: MissionItem.z is in meters. INavWaypoint.altitude is in cm.
 * Position: MissionItem.x/y are lat*1e7/lon*1e7. INavWaypoint.lat/lon are float degrees.
 *
 * Throws if the waypoint count exceeds INAV_MAX_WAYPOINTS (60), if an item's
 * command has no iNav equivalent, or if an item uses a terrain-relative frame.
 */
export function translateToInavWaypoints(items: MissionItem[]): INavWaypoint[] {
  // A speed item becomes a WAYPOINT p1; every other item is one iNav waypoint.
  const kept = items.filter((item) => item.command !== MAV_CMD_DO_CHANGE_SPEED)
  if (kept.length > INAV_MAX_WAYPOINTS) {
    throw new Error(`iNav mission limit exceeded: ${kept.length} waypoints, maximum is ${INAV_MAX_WAYPOINTS}.`)
  }
  // 1-based iNav number of the first kept item at or after each item index
  // (MAVLink DO_JUMP targets a 0-based index into `items`).
  const numberAt: number[] = []
  let keptSoFar = 0
  for (const item of items) {
    if (item.command === MAV_CMD_DO_CHANGE_SPEED) {
      numberAt.push(keptSoFar + 1)
    } else {
      keptSoFar += 1
      numberAt.push(keptSoFar)
    }
  }
  const jumpTargetNumber = (seq: number) => numberAt[seq] ?? seq + 1

  const out: INavWaypoint[] = []
  let speedCmS = 0
  for (const item of items) {
    if (item.command === MAV_CMD_DO_CHANGE_SPEED) {
      if (!(item.param2 > 0)) {
        throw new Error(`iNav cannot fly the speed change at item ${item.seq}: it sets no speed.`)
      }
      speedCmS = Math.round(item.param2 * 100)
      continue
    }
    const number = out.length + 1
    out.push({
      number,
      ...toInavAction(item, number, speedCmS, jumpTargetNumber),
      lat: item.x / 1e7,
      lon: item.y / 1e7,
      altitude: Math.round(item.z * 100), // meters to cm
      flag: number === kept.length ? INAV_WP_FLAG_LAST : 0,
    })
  }
  return out
}

/** The MAV_CMD and param1/param2 for one iNav waypoint. */
function fromInavAction(wp: INavWaypoint): Pick<MissionItem, 'command' | 'param1' | 'param2'> {
  switch (wp.action) {
    // WAYPOINT p1 and POSHOLD_TIME p2 are leg speeds, carried as speed items.
    case INAV_WP_ACTION.WAYPOINT:      return { command: MAV_CMD_NAV_WAYPOINT, param1: 0, param2: 0 }
    case INAV_WP_ACTION.POSHOLD_UNLIM: return { command: MAV_CMD_NAV_LOITER_UNLIM, param1: 0, param2: 0 }
    case INAV_WP_ACTION.POSHOLD_TIME:  return { command: MAV_CMD_NAV_LOITER_TIME, param1: wp.p1, param2: 0 }
    case INAV_WP_ACTION.RTH:           return { command: MAV_CMD_NAV_RETURN_TO_LAUNCH, param1: 0, param2: 0 }
    case INAV_WP_ACTION.LAND:          return { command: MAV_CMD_NAV_LAND, param1: 0, param2: wp.p2 }
    case INAV_WP_ACTION.JUMP:          return { command: MAV_CMD_DO_JUMP, param1: wp.p1 - 1, param2: wp.p2 }
    case INAV_WP_ACTION.SET_POI:       return { command: MAV_CMD_DO_SET_ROI, param1: 0, param2: 0 }
    case INAV_WP_ACTION.SET_HEAD:      return { command: MAV_CMD_CONDITION_YAW, param1: wp.p1, param2: 0 }
    default:
      throw new Error(`iNav waypoint ${wp.number} has unknown action ${wp.action}.`)
  }
}

/** The leg speed (m/s) an iNav waypoint sets, or undefined for the mission default. */
function inavLegSpeed(wp: INavWaypoint): number | undefined {
  const cms = wp.action === INAV_WP_ACTION.WAYPOINT || wp.action === INAV_WP_ACTION.LAND
    ? wp.p1
    : wp.action === INAV_WP_ACTION.POSHOLD_TIME ? wp.p2 : 0
  return cms >= INAV_MIN_WP_SPEED_CMS ? cms / 100 : undefined
}

/**
 * Convert iNav waypoints into MissionItems.
 *
 * Altitude: INavWaypoint.altitude is cm, MissionItem.z is meters.
 * Position: INavWaypoint.lat/lon are float degrees, MissionItem.x/y are lat*1e7/lon*1e7.
 * Frame: `p3` bit 0 set means AMSL (MAV_FRAME_GLOBAL), clear means above home.
 * Speed: a waypoint whose leg speed differs from the one carried so far is
 * preceded by a DO_CHANGE_SPEED item, and a JUMP to it targets that item so
 * the repeated leg flies at the same speed. A return to the mission default
 * after a set speed has no DO_CHANGE_SPEED form, so the set speed carries on.
 */
export function translateFromInavWaypoints(wps: INavWaypoint[]): MissionItem[] {
  const items: MissionItem[] = []
  /** Output index of the first item each iNav waypoint (by position) produced. */
  const firstIndex: number[] = []
  let carried: number | undefined
  for (const wp of wps) {
    firstIndex.push(items.length)
    const frame = (wp.p3 & 1) === 1 ? MAV_FRAME_GLOBAL : MAV_FRAME_GLOBAL_RELATIVE_ALT
    const speed = inavLegSpeed(wp)
    if (speed !== undefined && speed !== carried) {
      items.push(speedItem(speed, 0, frame))
      carried = speed
    }
    items.push({
      seq: 0,
      frame,
      ...fromInavAction(wp),
      current: 0,
      autocontinue: 1,
      param3: 0,
      param4: 0,
      x: Math.round(wp.lat * 1e7),
      y: Math.round(wp.lon * 1e7),
      z: wp.altitude / 100, // cm to meters
    })
  }
  return items.map((item, idx) => ({
    ...item,
    seq: idx,
    current: idx === 0 ? 1 : 0,
    param1: item.command === MAV_CMD_DO_JUMP ? firstIndex[item.param1] ?? item.param1 : item.param1,
  }))
}
