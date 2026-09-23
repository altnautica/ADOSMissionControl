/**
 * Plugin `cloud.read` handler.
 *
 * A plugin half can ask the GCS to run a Convex function on its behalf. The
 * policy gate lives in `../cloud-allowlist.ts` (allowlist + arg validation +
 * rate limit) and is pure; this handler owns the live Convex client (injected
 * as `cloudQuery`) and calls the gate before dispatching. The bridge has
 * already checked the `cloud.read` capability before the handler runs.
 *
 * Reads are confined to a tiny public-query allowlist. There is no plugin
 * cloud write: every reviewed mutation writes under the operator's identity.
 *
 * @module plugins/handlers/cloud
 * @license GPL-3.0-only
 */

import type { BridgeHandler } from "@/lib/plugins/bridge";
import {
  isAllowedCloudRead,
  validateCloudArgs,
  checkCloudRateLimit,
} from "@/lib/plugins/cloud-allowlist";
import { asRecord, readString } from "./args";

/** Runs a Convex function for the plugin. Wired by the contribution producer. */
export type CloudQuery = (
  fn: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

/**
 * Build the `cloud.read` handler for one plugin. When
 * `cloudQuery` is absent (producer has not wired a live client) `cloud.read`
 * returns an error result rather than throwing.
 */
export function buildCloudHandlers(
  pluginId: string,
  cloudQuery?: CloudQuery,
): Record<string, BridgeHandler> {
  const cloudRead: BridgeHandler = async (args) => {
    const fn = readString(args, "fn");
    if (!fn) return { ok: false, error: "cloud.read requires a function name" };
    if (!isAllowedCloudRead(fn)) return { ok: false, error: "not allowed" };

    // Pass the raw value so the validator rejects non-objects rather than
    // silently coercing them away.
    const validated = validateCloudArgs(fn, asRecord(args).args);
    if (!validated.ok) return { ok: false, error: validated.reason };

    if (!checkCloudRateLimit(pluginId, Date.now())) {
      return { ok: false, error: "rate limit exceeded" };
    }
    if (!cloudQuery) return { ok: false, error: "cloud unavailable" };

    const result = await cloudQuery(fn, validated.args);
    return { ok: true, result };
  };

  return {
    "cloud.read": cloudRead,
  };
}
