/**
 * Per-node telemetry sourcing, shared by every surface that asks what one
 * fleet node is reporting.
 *
 * Two maps carry a node's telemetry. The heartbeat row
 * (`cloudStatuses[deviceId].telemetry`) is filled by the LAN status poll; the
 * live stream (`telemetryByDeviceId`) is filled by the MQTT bridge for
 * cloud-paired nodes, whose heartbeat rows carry no telemetry at all. So a
 * consumer that reads only the heartbeat row sees nothing for exactly the
 * nodes the cloud lane exists to serve. `telemetryValue` is the single merge
 * rule — live stream first, heartbeat row as fallback — and both the display
 * cells and the command gates read through it, so the two can never disagree
 * about whether a node's flight state is known.
 *
 * @module nodes/presence
 * @license GPL-3.0-only
 */

import type {
  CommandCloudStatus,
  CommandTelemetrySnapshot,
} from "@/stores/command-fleet-store";

/**
 * The one rule for reading a node's telemetry from the fleet store: the live
 * stream when it has published, else the heartbeat row's snapshot.
 */
export function telemetryValue(
  telemetry: CommandTelemetrySnapshot | undefined,
  status: CommandCloudStatus | undefined,
): CommandTelemetrySnapshot | undefined {
  return telemetry ?? status?.telemetry;
}
