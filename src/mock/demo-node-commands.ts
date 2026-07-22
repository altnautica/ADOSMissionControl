/**
 * Demo-mode effects for commands sent to a simulated node.
 *
 * The simulated fleet rebuilds its telemetry from a fixed table on every tick,
 * so a command that only wrote to the store would be overwritten before the
 * operator saw it. This module holds the per-node deltas a command produced;
 * the demo tick folds them onto the table it emits, and a mode change or a
 * disarm made from the fleet board shows up in the row a moment later — the
 * same sequence the cloud lane produces, where the queue accepts a command and
 * the vehicle's state follows.
 *
 * Demo only. Nothing here is reachable when the mock engine is off.
 *
 * @module mock/demo-node-commands
 * @license GPL-3.0-only
 */

/** The telemetry fields a demo command can move. */
export interface DemoTelemetryOverride {
  armed?: boolean;
  mode?: string;
}

const overrides = new Map<string, DemoTelemetryOverride>();

function patch(deviceId: string, next: DemoTelemetryOverride): void {
  overrides.set(deviceId, { ...overrides.get(deviceId), ...next });
}

/**
 * Apply one agent command to the simulated node. Command names are the agent's
 * own; anything else leaves the node untouched, which is what a simulated node
 * with no handler for a command would do.
 */
export function applyDemoNodeCommand(
  deviceId: string,
  cmd: string,
  args: readonly unknown[] = [],
): void {
  switch (cmd) {
    case "arm":
      patch(deviceId, { armed: true });
      return;
    case "disarm":
      patch(deviceId, { armed: false });
      return;
    case "takeoff":
      patch(deviceId, { armed: true, mode: "GUIDED" });
      return;
    case "rtl":
      patch(deviceId, { mode: "RTL" });
      return;
    case "land":
      patch(deviceId, { mode: "LAND" });
      return;
    case "mode": {
      const target = args[0];
      if (typeof target === "string") patch(deviceId, { mode: target });
      return;
    }
    default:
      return;
  }
}

/** The deltas a node has accumulated, or undefined when it has none. */
export function demoTelemetryOverride(
  deviceId: string,
): DemoTelemetryOverride | undefined {
  return overrides.get(deviceId);
}

/** Drop every accumulated delta (demo teardown). */
export function clearDemoNodeCommands(): void {
  overrides.clear();
}
