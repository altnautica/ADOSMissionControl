/**
 * @module lib/api/signing-cloud-sync
 * @description Convex client for the cloud copy of a drone's MAVLink signing
 * key. Uploading keys is off until encrypted storage exists, so this module
 * only answers whether a cloud copy exists and removes one.
 *
 * Both functions require Convex auth. The UI must gate calls on
 * `isAuthenticated` before invoking anything here; otherwise Convex throws and
 * the catch surfaces an error toast.
 *
 * Read discipline: the cloud row carries NO key material. `getForDrone`
 * answers "is there a synced key, and which one" and nothing more.
 *
 * @license GPL-3.0-only
 */

import type { ConvexReactClient } from "convex/react";
import { cmdSigningKeysApi } from "@/lib/community-api-drones";

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
