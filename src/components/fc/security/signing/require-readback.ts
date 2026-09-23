/**
 * @module components/fc/security/signing/require-readback
 * @description Read SIGNING_REQUIRE back after writing it. The agent's PUT
 * sends a PARAM_SET and returns without waiting for the FC, so its answer says
 * only that the frame went out. The value the panel shows is the one the FC
 * reports afterwards; `null` means the FC reports no such parameter.
 * @license GPL-3.0-only
 */

import type { AgentClient } from "@/lib/agent/client";

export const REQUIRE_READBACK_ATTEMPTS = 6;
export const REQUIRE_READBACK_INTERVAL_MS = 500;

/**
 * Poll the FC-reported SIGNING_REQUIRE until it equals `expected` or the
 * attempts run out, and return the last value read (null when unread).
 */
export async function readBackRequire(
  client: Pick<AgentClient, "getSigningRequire">,
  expected: boolean,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<boolean | null> {
  let last: boolean | null = null;
  for (let i = 0; i < REQUIRE_READBACK_ATTEMPTS; i++) {
    if (i > 0) await sleep(REQUIRE_READBACK_INTERVAL_MS);
    try {
      last = (await client.getSigningRequire()).require;
    } catch {
      last = null;
    }
    if (last === expected) return last;
  }
  return last;
}
