/**
 * @module heartbeatCasing
 * @description Snake_case -> camelCase key remap for the nested heartbeat
 * sub-blocks whose agent producers emit snake_case on the wire.
 *
 * Several nested blocks on the cloud-relay heartbeat (the radio link block, the
 * CRSF/ExpressLRS control-lane block) are emitted with snake_case keys by the
 * agent (`rssi_dbm`, `lq_uplink`, ...), while the `pushStatus` args validator
 * and the `cmd_droneStatus` schema declare them camelCase. Those validators are
 * strict `v.object()`s: an undeclared key does not get dropped, it rejects the
 * ENTIRE heartbeat. So a snake-keyed block must be converted before it reaches
 * the mutation or a node running that feature goes dark in cloud mode every
 * tick.
 *
 * This is a pure, self-contained module (no Convex runtime dependency) so the
 * exact transform the `/agent/status` route runs can be exercised directly by a
 * route-level round-trip test.
 *
 * @license GPL-3.0-only
 */

/** Convert a single snake_case key to camelCase (`rssi_dbm` -> `rssiDbm`). */
export function snakeToCamelKey(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
}

/**
 * Remap every top-level key of a plain object from snake_case to camelCase.
 *
 * Returns `undefined` for a missing, non-object, or array value so a malformed
 * sub-block is DROPPED rather than being passed to the strict validator (which
 * would reject the whole heartbeat). Values are forwarded verbatim; only keys
 * are rewritten.
 */
export function snakeToCamelObject(
  raw: unknown,
): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, value] of Object.entries(raw as Record<string, unknown>)) {
    out[snakeToCamelKey(k)] = value;
  }
  return out;
}
