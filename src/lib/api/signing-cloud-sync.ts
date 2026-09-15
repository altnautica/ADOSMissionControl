/**
 * @module lib/api/signing-cloud-sync
 * @description Convex cloud-sync client for MAVLink signing keys.
 *
 * All six functions require Convex auth. The UI must gate calls on
 * `isAuthenticated` before invoking anything here; otherwise Convex
 * throws and the catch surfaces an error toast.
 *
 * Log discipline: this module NEVER logs `keyHex`. `keyId` (the 8-char
 * fingerprint) is the only public-safe identifier for display or log.
 *
 * Read discipline: the cloud row carries NO key material. `getForDrone`
 * answers "is there a synced key, and which one" and nothing more; the
 * backend hands out `keyHex` only through `cmdSigningKeys.exportKey`,
 * an explicit operator export that writes its own audit row.
 *
 * @license GPL-3.0-only
 */

import type { ConvexReactClient } from "convex/react";
import { cmdSigningKeysApi } from "@/lib/community-api-drones";

export function isCloudSigningKeySyncEnabled(): boolean {
  return false;
}

/** A synced key's metadata. Deliberately no `keyHex`: the query that
 *  returns this shape does not carry key material. */
export interface CloudSigningKey {
  _id: string;
  userId: string;
  droneId: string;
  keyId: string;
  linkIdOwner: number;
  linkIdsInUse: number[];
  enrolledAt: string;
  updatedAt: number;
}

/**
 * Upload a signing key for the authenticated user and drone. This is
 * called from two places:
 *   1. Enroll flow, when the cloud-sync checkbox is ticked.
 *   2. Rotate flow, when the cloud sync is already on for this drone.
 *
 * The raw hex only touches memory for the one-shot POST; callers should
 * zeroize the source buffer immediately after awaiting this.
 */
export async function uploadKey(
  client: ConvexReactClient,
  args: {
    droneId: string;
    keyHex: string;
    keyId: string;
    linkIdOwner: number;
    enrolledAt: string;
  },
): Promise<{ _id: string; keyId: string }> {
  if (isCloudSigningKeySyncEnabled()) {
    return client.mutation(cmdSigningKeysApi.store, args);
  }
  void client;
  void args;
  throw new Error("Cloud signing-key sync is disabled until encrypted storage is available.");
}

/** List every drone this user has cloud-synced a signing key for. */
export async function listMyCloudKeys(
  client: ConvexReactClient,
): Promise<CloudSigningKey[]> {
  return (await client.query(cmdSigningKeysApi.listMine, {})) as CloudSigningKey[];
}

/** Fetch a single drone's cloud-synced key, if any. */
export async function getCloudKeyForDrone(
  client: ConvexReactClient,
  droneId: string,
): Promise<CloudSigningKey | null> {
  return (await client.query(cmdSigningKeysApi.getForDrone, { droneId })) as
    | CloudSigningKey
    | null;
}

/** Remove a cloud-synced signing key for this drone. */
export async function removeCloudKey(
  client: ConvexReactClient,
  droneId: string,
): Promise<{ removed: boolean }> {
  return client.mutation(cmdSigningKeysApi.removeKey, { droneId });
}

/**
 * Claim the lowest-unused link_id in [1, 254] for this drone. Used
 * instead of the local fingerprint allocator when cloud sync is on, so
 * multi-device deployments never collide on link_id.
 */
export async function allocateCloudLinkId(
  client: ConvexReactClient,
  droneId: string,
): Promise<number> {
  const result = (await client.mutation(cmdSigningKeysApi.allocateLinkId, {
    droneId,
  })) as { linkId: number };
  return result.linkId;
}

/** Release a previously claimed link_id. Called on opt-out. */
export async function releaseCloudLinkId(
  client: ConvexReactClient,
  droneId: string,
  linkId: number,
): Promise<{ released: boolean }> {
  return client.mutation(cmdSigningKeysApi.releaseLinkId, {
    droneId,
    linkId,
  });
}

/**
 * Export the raw key for one drone. The only path that returns key
 * material, and it is audited server-side as an `export` signing event.
 * The caller owns the returned buffer and must zeroize it immediately
 * after `importNonExtractableKey`.
 *
 * `deviceFingerprint` is the same short opaque browser hash the signing
 * event log takes — never a userId, never PII.
 */
export async function exportCloudKeyBytes(
  client: ConvexReactClient,
  droneId: string,
  deviceFingerprint: string,
): Promise<{ bytes: Uint8Array; keyId: string } | null> {
  const exported = (await client.mutation(cmdSigningKeysApi.exportKey, {
    droneId,
    deviceFingerprint,
  })) as { keyHex: string; keyId: string } | null;
  if (!exported) return null;
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(exported.keyHex.slice(i * 2, i * 2 + 2), 16);
  }
  return { bytes, keyId: exported.keyId };
}
