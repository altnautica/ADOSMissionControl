/**
 * @module lib/api/radio-pairing
 * @description GCS-side helpers for the WFB radio pairing flow.
 *
 * Two paths converge on the same persisted state:
 *
 * - **Local-radio bind** (primary, RubyFPV-style auto-pair on first
 *   boot, or operator-triggered "Open local bind window" button).
 *   Routes through `openLocalBind()` against whichever rig the user
 *   is acting on; the agent runs the upstream wfb-ng bind protocol
 *   over the radio itself with a separate `*_bind` profile + L3
 *   tunnel + socat. Synchronous (up to 300 s) — the GCS just renders the
 *   returned `LocalBindSession` terminal state.
 *
 * - **Cloud-relay** (secondary, used when the rigs cannot reach each
 *   other on the radio — e.g., drone in the field on 4G, GS at
 *   home). The `pairRigsRemote` helper enqueues `wfb_pair_init_remote`
 *   on the GS, waits for the agent to finish via the reactive
 *   command-status query, reads the returned `drone.key` blob from
 *   the command result, enqueues `wfb_pair_apply_remote` on the
 *   drone with that blob, waits again, then runs a fingerprint
 *   cross-check via `finalizePairing`. On mismatch the orchestrator
 *   action enqueues unpair on both rigs.
 *
 * The GCS owns the cloud orchestration loop because Convex actions
 * cannot be reactive and a sleep-loop in an action would burn function
 * time. The `useMutation` + reactive `useQuery` pattern this file uses
 * is the same one in `PairingDialog.tsx` for user-account pairing.
 *
 * @license GPL-3.0-only
 */

"use client";

import type { ConvexReactClient } from "convex/react";

import type {
  LocalBindSession,
  PairStatusResponse,
  AutoPairToggleResponse,
} from "@/lib/api/ground-station/types";
import {
  getLocalBindStatus,
  getPairStatus,
  openLocalBind,
  setAutoPair,
  unpairRadio,
} from "@/lib/api/ground-station/wfb";
import type { RequestContext } from "@/lib/api/ground-station/request";

import { cmdRadioPairingApi } from "@/lib/community-api-drones";

// ── Local-radio bind path ─────────────────────────────────────────

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

/** Best-effort poll of the agent's last bind session. Used to refresh
 *  the GCS card between heartbeat ticks during a long bind. */
export async function pollLocalBind(
  ctx: RequestContext,
): Promise<LocalBindSession | null> {
  const snapshot = await getLocalBindStatus(ctx);
  if (snapshot && typeof snapshot === "object" && "session_id" in snapshot) {
    return snapshot as LocalBindSession;
  }
  return null;
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

// ── Cloud-relay path ──────────────────────────────────────────────

interface CommandRow {
  _id: string;
  status: "pending" | "completed" | "failed";
  result?: { success: boolean; message: string };
  data?: unknown;
}

const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 30_000;

/** Block until a command row reaches a terminal state, or timeout. */
async function pollCommand(
  client: ConvexReactClient,
  commandId: string,
): Promise<CommandRow> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const row = (await client.query(cmdRadioPairingApi.getCommandWithData, {
      // The mutation returns `{ commandId }` typed as Id<"cmd_droneCommands">;
      // we accept it as a string here and let Convex type-coercion handle it.
      commandId: commandId as never,
    })) as CommandRow | null;
    if (row && row.status !== "pending") {
      return row;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new RadioPairTimeoutError(
    `Cloud command ${commandId} did not complete within ${POLL_TIMEOUT_MS}ms`,
  );
}

export class RadioPairTimeoutError extends Error {}
export class RadioPairFingerprintError extends Error {}
export class RadioPairAgentError extends Error {}

export interface PairRigsRemoteResult {
  paired: boolean;
  fingerprint: string | null;
  gsDeviceId: string;
  droneDeviceId: string;
  pairedAt: string | null;
}

/** Cloud-relay pair flow. End-to-end: enqueue init on the GS, poll
 *  for completion, read the drone.key blob, enqueue apply on the
 *  drone, poll, finalize with a server-side fingerprint cross-check,
 *  and roll back via `wfb_pair_unpair` on mismatch.
 *
 *  This is NOT the local-radio bind path. Use it only when the two
 *  rigs cannot reach each other on the radio (drone on 4G in the
 *  field, GS at home). */
export async function pairRigsRemote(
  client: ConvexReactClient,
  args: { gsDeviceId: string; droneDeviceId: string },
): Promise<PairRigsRemoteResult> {
  const { gsDeviceId, droneDeviceId } = args;

  // 1. Enqueue init on the GS rig.
  const initCmd = (await client.mutation(
    cmdRadioPairingApi.enqueueWfbPairInit,
    { gsDeviceId, droneDeviceId },
  )) as { commandId: string };

  // 2. Wait for the GS to generate the keypair and return the drone
  //    half via the command result `data` payload.
  const initRow = await pollCommand(client, initCmd.commandId);
  if (initRow.status !== "completed") {
    throw new RadioPairAgentError(
      initRow.result?.message ?? "wfb_pair_init_remote failed on the GS",
    );
  }
  const initData = (initRow.data ?? {}) as {
    blobB64?: string;
    fingerprint?: string;
  };
  if (!initData.blobB64) {
    throw new RadioPairAgentError(
      "wfb_pair_init_remote completed but did not return a blobB64",
    );
  }

  // 3. Forward the blob to the drone rig.
  const applyCmd = (await client.mutation(
    cmdRadioPairingApi.enqueueWfbPairApply,
    {
      droneDeviceId,
      gsDeviceId,
      blobB64: initData.blobB64,
    },
  )) as { commandId: string };

  // 4. Wait for the drone to apply the blob.
  const applyRow = await pollCommand(client, applyCmd.commandId);
  if (applyRow.status !== "completed") {
    // Roll back the GS side: enqueue an unpair so the rig does not
    // sit in a half-paired state where the GS holds keys for a
    // peer that never finished pairing.
    try {
      await client.mutation(cmdRadioPairingApi.enqueueWfbPairUnpair, {
        deviceId: gsDeviceId,
      });
    } catch {
      // Best-effort rollback. The operator can `unpair` from the
      // GS card if this fails.
    }
    throw new RadioPairAgentError(
      applyRow.result?.message ?? "wfb_pair_apply_remote failed on the drone",
    );
  }
  const applyData = (applyRow.data ?? {}) as { fingerprint?: string };

  // 5. Server-side fingerprint cross-check + atomic completion.
  const finalize = (await client.mutation(
    cmdRadioPairingApi.finalizePairing,
    {
      gsDeviceId,
      droneDeviceId,
      gsFingerprint: initData.fingerprint ?? null,
      droneFingerprint: applyData.fingerprint ?? null,
    },
  )) as
    | {
        paired: true;
        fingerprint: string;
        gsDeviceId: string;
        droneDeviceId: string;
        pairedAt: string;
      }
    | {
        paired: false;
        reason: string;
        gsFingerprint: string | null;
        droneFingerprint: string | null;
      };

  if (!finalize.paired) {
    throw new RadioPairFingerprintError(
      `fingerprint mismatch: gs=${finalize.gsFingerprint} drone=${finalize.droneFingerprint}`,
    );
  }
  return {
    paired: true,
    fingerprint: finalize.fingerprint,
    gsDeviceId: finalize.gsDeviceId,
    droneDeviceId: finalize.droneDeviceId,
    pairedAt: finalize.pairedAt,
  };
}

/** Cloud-relay unpair. Used by the GCS UI's "Unpair" button when the
 *  rig is reachable only via cloud. */
export async function unpairRigRemote(
  client: ConvexReactClient,
  deviceId: string,
): Promise<void> {
  await client.mutation(cmdRadioPairingApi.enqueueWfbPairUnpair, {
    deviceId,
  });
}
