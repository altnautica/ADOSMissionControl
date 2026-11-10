/**
 * MAVLink adapter — per-connection requests.
 *
 * What the adapter asks the flight controller for once a connection is up
 * (and again after a link restore or an FC reboot): the telemetry stream
 * rates, the landed-state interval, and the one-shot messages that fill the
 * vehicle's version, EKF origin and capabilities. All of it is housekeeping:
 * a refusal or no answer leaves the value unknown and never fails the link.
 *
 * @module protocol/mavlink-adapter-session
 */

import type { CommandResult } from './types'
import { useSettingsStore } from '@/stores/settings-store'
import { requestDataStreams, type FrameHandlerState } from './mavlink-adapter-frame-handlers'

/** The adapter's COMMAND_LONG sender. */
export type SendCommandLong = (
  cmd: number,
  p: [number, number, number, number, number, number, number],
) => Promise<CommandResult>

const MAV_CMD_SET_MESSAGE_INTERVAL = 511
const MAV_CMD_REQUEST_MESSAGE = 512

/** Request telemetry rates; a send failure is logged, never thrown. */
export function requestStreamRates(st: FrameHandlerState, send: SendCommandLong): void {
  try {
    requestDataStreams(st)
  } catch (err) {
    console.warn('[MAVLinkAdapter] stream-rate request failed:', err)
  }
  // EXTENDED_SYS_STATE (245) at 1 Hz is the flight controller's landed state,
  // which Disarm gates on. A reboot drops the interval, so it rides every
  // re-request; the PX4 stream set already carries it when the GCS manages
  // rates. A refusal or no answer just leaves the landed state unknown.
  const px4Streams = st.firmwareHandler?.firmwareType === 'px4'
    && useSettingsStore.getState().gcsManagesTelemetryRates
  if (!px4Streams) send(MAV_CMD_SET_MESSAGE_INTERVAL, [245, 1_000_000, 0, 0, 0, 0, 0]).catch(() => {})
}

/** The one-shot messages asked for once per connection. */
export function requestConnectMessages(st: FrameHandlerState, send: SendCommandLong): void {
  // GPS_GLOBAL_ORIGIN (49) is sent when the origin is set; ask once in case
  // that happened before this connection. AUTOPILOT_VERSION (148).
  for (const id of [242, 49, 148]) {
    send(MAV_CMD_REQUEST_MESSAGE, [id, 0, 0, 0, 0, 0, 0]).catch(() => {})
  }
  // COMPONENT_METADATA (397) is a PX4-only "component information" message;
  // ArduPilot does not implement it, so only request it for PX4 vehicles.
  if (st.firmwareHandler?.firmwareType === 'px4') {
    send(MAV_CMD_REQUEST_MESSAGE, [397, 0, 0, 0, 0, 0, 0]).catch(() => {})
  }
}
