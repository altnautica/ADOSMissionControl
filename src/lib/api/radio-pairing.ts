/**
 * @module lib/api/radio-pairing
 * @description GCS-side helpers for the WFB radio pairing flow over the
 * agent's REST surface.
 *
 * Pairing runs as a local-radio bind: auto-pair on first boot, or the
 * operator-triggered "Open local bind window" button. The GCS calls
 * `openLocalBind()` against whichever rig the user is acting on; the agent
 * runs the wfb-ng bind protocol over the radio itself with a separate
 * `*_bind` profile, L3 tunnel and socat. The call is synchronous (up to
 * 300 s) and returns the terminal `LocalBindSession`.
 *
 * @license GPL-3.0-only
 */

"use client";

import type {
  LocalBindSession,
  PairStatusResponse,
  AutoPairToggleResponse,
} from "@/lib/api/ground-station/types";
import {
  getPairStatus,
  openLocalBind,
  setAutoPair,
  unpairRadio,
} from "@/lib/api/ground-station/wfb";
import type { RequestContext } from "@/lib/api/ground-station/request";

export interface LocalBindOptions {
  role?: "drone" | "gs";
  peerDeviceId?: string;
}

/** Kick off the local bind window on the agent at `ctx`. Returns the
 *  terminal session state when the protocol completes. The caller
 *  renders progress via the running `LocalBindSession.state`. */
export async function startLocalBind(
  ctx: RequestContext,
  options: LocalBindOptions = {},
): Promise<LocalBindSession> {
  return openLocalBind(ctx, {
    role: options.role,
    peer_device_id: options.peerDeviceId,
  });
}

/** Read pair-state status (paired flag, peer device-id, fingerprint,
 *  auto-pair, role) from the agent's REST surface. */
export async function fetchPairStatus(
  ctx: RequestContext,
): Promise<PairStatusResponse> {
  return getPairStatus(ctx);
}

/** Explicit unpair on the rig at `ctx`. Wipes both key files, clears
 *  pair state, restarts the wfb service. Leaves auto_pair_enabled
 *  false — re-arming is a separate call. */
export async function unpairRig(
  ctx: RequestContext,
): Promise<{ paired: false; role: "drone" | "gs" }> {
  return unpairRadio(ctx);
}

/** Toggle auto-pair on the rig. Re-arming is rejected (returns
 *  `rearm_blocked: true`) on a paired rig until the operator
 *  unpairs explicitly. */
export async function setAutoPairOnRig(
  ctx: RequestContext,
  enabled: boolean,
): Promise<AutoPairToggleResponse> {
  return setAutoPair(ctx, enabled);
}
