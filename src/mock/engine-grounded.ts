/**
 * Tick for a demo drone on the ground after a Land command
 * (mock-protocol-flight). It holds its touchdown point with motors idle and
 * keeps heartbeating its own arm state and mode, so the registry and the
 * selected-drone store track a landed vehicle, and a disarmed one once the
 * operator disarms it.
 *
 * @license GPL-3.0-only
 */

import { useNodeRegistryStore } from "@/stores/node-registry";
import { useTelemetryStore } from "@/stores/telemetry-store";
import type { MockProtocol } from "./mock-protocol";

/** Sticks centred, throttle and the mode channel low. */
const IDLE_RC = [1500, 1500, 1000, 1500, 1000, 1000, 1000, 1000, 1500, 1500, 1500, 1500, 1500, 1500, 1500, 1500];

export function tickGroundedDrone(
  nodeId: string,
  protocol: MockProtocol,
  tickCount: number,
  selected: boolean,
  now: number,
): void {
  const registry = useNodeRegistryStore.getState();
  const last = registry.getEntry(nodeId)?.fc.position;
  const position = last && {
    ...last,
    timestamp: now,
    alt: last.alt - (last.relativeAlt ?? 0),
    relativeAlt: 0,
    groundSpeed: 0,
    airSpeed: 0,
    climbRate: 0,
    vn: 0,
    ve: 0,
    vd: 0,
  };
  registry.updateFcTelemetry(nodeId, { lastHeartbeat: now, ...(position ? { position } : {}) });
  if (!selected) return;

  const heading = position?.heading ?? 0;
  useTelemetryStore.getState().pushBatch({
    attitude: { timestamp: now, roll: 0, pitch: 0, yaw: heading, rollSpeed: 0, pitchSpeed: 0, yawSpeed: 0 },
    ...(position ? { position } : {}),
    vfr: { timestamp: now, airspeed: 0, groundspeed: 0, heading, throttle: 0, alt: position?.alt ?? 0, climb: 0 },
    rc: { timestamp: now, channels: IDLE_RC, rssi: 230 },
  });
  protocol.setRcChannelValues(IDLE_RC);
  if (tickCount % 5 === 0) {
    protocol.emitHeartbeat(protocol.flight.armed, protocol.flight.mode);
    // EXTENDED_SYS_STATE: MAV_LANDED_STATE_ON_GROUND.
    protocol.emitExtendedSysState({ timestamp: now, vtolState: 0, landedState: 1 });
  }
}
