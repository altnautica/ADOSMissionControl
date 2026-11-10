/**
 * Finding the vehicle's MAVLink camera and where its commands go.
 *
 * CAMERA_INFORMATION is sent on request. The autopilot answers for the
 * cameras it drives itself, and a camera that speaks MAVLink answers from its
 * own component, which announces itself with a MAV_TYPE_CAMERA heartbeat. Each
 * is asked once per connection; nothing is re-sent when one stays silent.
 *
 * The component of the last CAMERA_INFORMATION that advertised still capture
 * or zoom is the one the capture and zoom commands address; until one has,
 * they go to the autopilot.
 *
 * @module protocol/mavlink-adapter-camera
 * @license GPL-3.0-only
 */

import type { CommandResult } from './types'
import type { MAVLinkFrame } from './mavlink-parser'
import {
  decodeHeartbeat, decodeCameraInformation,
  CAMERA_CAP_FLAGS_CAPTURE_IMAGE, CAMERA_CAP_FLAGS_HAS_BASIC_ZOOM,
} from './messages'

const MAV_TYPE_CAMERA = 30
const CAMERA_INFORMATION = 259
const MAV_CMD_REQUEST_MESSAGE = 512

/** The adapter's live connection target. */
export interface CameraTarget {
  readonly targetSysId: number
  readonly targetCompId: number
}

/** Ack-tracked COMMAND_LONG to one component of the target system. */
export type SendToComponent = (
  command: number,
  params: [number, number, number, number, number, number, number],
  targetCompId: number,
) => Promise<CommandResult>

export class CameraDiscovery {
  /** Components already asked for CAMERA_INFORMATION on this connection. */
  private readonly asked = new Set<number>()
  private cameraCompId: number | null = null

  constructor(
    private readonly target: CameraTarget,
    private readonly send: SendToComponent,
  ) {}

  /** The component camera commands address. */
  get commandCompId(): number {
    return this.cameraCompId ?? this.target.targetCompId
  }

  /** Ask the autopilot once; call when the connection is up. */
  start(): void {
    this.ask(this.target.targetCompId)
  }

  /** Watch an inbound frame for a camera heartbeat or a camera's answer. */
  observe(frame: MAVLinkFrame): void {
    if (frame.systemId !== this.target.targetSysId) return
    if (frame.msgId === 0) {
      if (decodeHeartbeat(frame.payload).type === MAV_TYPE_CAMERA) this.ask(frame.componentId)
    } else if (frame.msgId === CAMERA_INFORMATION) {
      const { flags } = decodeCameraInformation(frame.payload)
      if (flags & (CAMERA_CAP_FLAGS_CAPTURE_IMAGE | CAMERA_CAP_FLAGS_HAS_BASIC_ZOOM)) this.cameraCompId = frame.componentId
    }
  }

  /** Forget the cameras of a connection that ended. */
  reset(): void {
    this.asked.clear()
    this.cameraCompId = null
  }

  private ask(compId: number): void {
    if (this.asked.has(compId)) return
    this.asked.add(compId)
    this.send(MAV_CMD_REQUEST_MESSAGE, [CAMERA_INFORMATION, 0, 0, 0, 0, 0, 0], compId).catch(() => {})
  }
}
