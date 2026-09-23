/**
 * IndexedDB keystore for MAVLink v2 signing keys.
 *
 * Stores non-extractable CryptoKey handles plus metadata. Keys never
 * leave the browser (except in the one-shot enrollment POST that happens
 * before the raw bytes are imported as non-extractable; see
 * `mavlink-signer.ts` / `signing-api.ts`).
 *
 * Records are tagged with the owning `userId` at import time. On every
 * auth state change the keystore purges records that do not match the
 * current user, so keys do not leak across a user switch on a shared
 * machine.
 *
 * @module protocol/signing-keystore
 */

import { createStore, get, set, del, keys as idbKeys } from "idb-keyval";

import {
  MavlinkSigner,
  importNonExtractableKey,
  keyFingerprint,
  zeroize,
} from "./mavlink-signer";

// Dedicated IndexedDB database + object store for signing keys. Kept
// separate from the default keyval store so a wipe of signing keys
// does not touch unrelated persisted data.
const SIGNING_DB_NAME = "ados-signing-keys";
const SIGNING_STORE_NAME = "signing-keys-v1";

// Private cache of the createStore() result. Instantiated lazily because
// idb-keyval opens the DB on first use.
let _storePromise: ReturnType<typeof createStore> | null = null;
function signingStore() {
  if (_storePromise === null) {
    _storePromise = createStore(SIGNING_DB_NAME, SIGNING_STORE_NAME);
  }
  return _storePromise;
}

/**
 * On-disk shape for each droneId. The CryptoKey is non-extractable;
 * structured-clone serializes it as an opaque reference that only
 * Web Crypto knows how to use.
 */
export interface SigningKeyRecord {
  droneId: string;
  userId: string | null;
  cryptoKey: CryptoKey;
  keyId: string;
  linkId: number;
  enrolledAt: string;
  enrollmentState:
    | "enrolled"
    | "pending_fc_online"
    | "fc_rejected"
    // A new key went (or may have gone) to the FC with no confirmation: an
    // interrupted enrollment or rotation. The key before it is kept in
    // `previous` until the operator confirms which one the FC holds.
    | "unconfirmed"
    // A disable was sent to the FC, which never acknowledges SETUP_SIGNING.
    // The key is kept until the operator confirms unsigned commands work.
    | "disable_unconfirmed";
  /** The key this record replaced while `enrollmentState` is "unconfirmed". */
  previous?: RetainedKey | null;
}

/** A superseded key kept until the FC's state is confirmed. */
export interface RetainedKey {
  cryptoKey: CryptoKey;
  keyId: string;
  linkId: number;
  enrolledAt: string;
}

/**
 * Enrollment state flows:
 *   pending_fc_online -> enrolled  (drone came online, SETUP_SIGNING accepted)
 *   pending_fc_online -> fc_rejected (drone came online, FC rejected our key)
 *   enrolled         -> fc_rejected (later mismatch detected at runtime)
 *   unconfirmed      -> enrolled  (operator confirmed the new key, or restored the previous one)
 *   enrolled         -> disable_unconfirmed -> (record cleared once unsigned commands are confirmed)
 */
export type EnrollmentState = SigningKeyRecord["enrollmentState"];

// ──────────────────────────────────────────────────────────────
// Core CRUD
// ──────────────────────────────────────────────────────────────

/**
 * Import raw key bytes as a non-extractable CryptoKey and store the
 * record. The caller MUST treat `keyBytes` as sensitive; this function
 * zeroizes the buffer in place before returning so any further reads
 * through the same reference see zeros.
 */
export async function importAndStore(opts: {
  droneId: string;
  userId: string | null;
  keyBytes: Uint8Array;
  linkId: number;
  enrollmentState?: EnrollmentState;
  /** Keep the key being replaced in `previous` (only for "unconfirmed"). */
  keepPrevious?: boolean;
}): Promise<SigningKeyRecord> {
  const { droneId, userId, keyBytes, linkId } = opts;
  const enrollmentState = opts.enrollmentState ?? "enrolled";

  const keyId = await keyFingerprint(keyBytes);
  const cryptoKey = await importNonExtractableKey(keyBytes);

  // Zeroize now that the CryptoKey holds the material browser-side.
  zeroize(keyBytes);

  const current = opts.keepPrevious ? await getRecord(droneId) : null;
  const record: SigningKeyRecord = {
    droneId,
    userId,
    cryptoKey,
    keyId,
    linkId,
    enrolledAt: new Date().toISOString(),
    enrollmentState,
    previous: current
      ? { cryptoKey: current.cryptoKey, keyId: current.keyId, linkId: current.linkId, enrolledAt: current.enrolledAt }
      : null,
  };
  await set(droneId, record, await signingStore());
  return record;
}

/**
 * Settle an "unconfirmed" record: keep the new key (`use: "current"`) or put
 * the retained previous key back (`use: "previous"`). Either way the record
 * becomes "enrolled" and nothing is retained. Returns the settled record, or
 * null when there is no record (or no previous key to restore).
 */
export async function settleUnconfirmedKey(
  droneId: string,
  use: "current" | "previous",
): Promise<SigningKeyRecord | null> {
  const rec = await getRecord(droneId);
  if (!rec) return null;
  let settled: SigningKeyRecord;
  if (use === "previous") {
    if (!rec.previous) return null;
    settled = { ...rec, ...rec.previous, enrollmentState: "enrolled", previous: null };
  } else {
    settled = { ...rec, enrollmentState: "enrolled", previous: null };
  }
  await set(droneId, settled, await signingStore());
  return settled;
}

/**
 * Fetch a drone's signer record, if any. Returns null when no key is
 * stored for the given droneId. Does not decrypt or expose raw bytes
 * (the CryptoKey stays non-extractable).
 */
export async function getRecord(droneId: string): Promise<SigningKeyRecord | null> {
  const rec = (await get(droneId, await signingStore())) as SigningKeyRecord | undefined;
  return rec ?? null;
}

/**
 * Fetch a MavlinkSigner ready to sign frames for this drone, or null
 * when no key is stored.
 */
export async function getSigner(droneId: string): Promise<MavlinkSigner | null> {
  const rec = await getRecord(droneId);
  // An unconfirmed record signs with the new key: any SETUP_SIGNING frame
  // that reached the FC installed it.
  if (!rec || (rec.enrollmentState !== "enrolled" && rec.enrollmentState !== "unconfirmed")) {
    return null;
  }
  return new MavlinkSigner(rec.droneId, rec.linkId, rec.keyId, rec.cryptoKey);
}

/**
 * Update just the enrollment state. Used by the state machine when the
 * drone transitions online or a key mismatch is detected.
 */
export async function updateEnrollmentState(
  droneId: string,
  state: EnrollmentState,
): Promise<void> {
  const rec = await getRecord(droneId);
  if (!rec) return;
  rec.enrollmentState = state;
  await set(droneId, rec, await signingStore());
}

/**
 * Remove a single drone's key. Garbage collection releases the
 * non-extractable CryptoKey; raw bytes were never stored.
 */
export async function clear(droneId: string): Promise<void> {
  await del(droneId, await signingStore());
}

/**
 * List every droneId that has a stored key. Used by purge and by the
 * app-boot cloud-sync pull to decide which drones need a fresh download.
 */
export async function listDroneIds(): Promise<string[]> {
  const allKeys = await idbKeys(await signingStore());
  return allKeys.map((k) => String(k));
}

// ──────────────────────────────────────────────────────────────
// User-switch purge
// ──────────────────────────────────────────────────────────────

/**
 * Delete every record whose userId does not match `currentUserId` and
 * is not null.
 *
 * Semantics:
 *   - Records with `userId === null` are "anonymous device-local" keys
 *     that were enrolled while the user was signed out. They belong to
 *     the device, not to any account, and are preserved across sign-in
 *     events.
 *   - Records with `userId === currentUserId` are the current user's
 *     own keys. They are preserved.
 *   - Records with `userId !== currentUserId && userId !== null` are
 *     another account's keys that never should have been readable here.
 *     They get deleted.
 *
 * Call on every auth state change (sign-in, sign-out, account switch).
 * Pass `null` on sign-out to leave anonymous keys intact but drop every
 * account-owned key.
 */
export async function purgeForUser(currentUserId: string | null): Promise<number> {
  const store = await signingStore();
  const allKeys = await idbKeys(store);
  let deleted = 0;
  for (const key of allKeys) {
    const rec = (await get(key, store)) as SigningKeyRecord | undefined;
    if (!rec) continue;
    const owner = rec.userId;
    if (owner === null) continue;             // anonymous, preserve
    if (owner === currentUserId) continue;    // current user, preserve
    await del(key, store);
    deleted += 1;
  }
  return deleted;
}

// ──────────────────────────────────────────────────────────────
// Timestamp persistence. Stub here so the signer can bolt onto it
// without a second IndexedDB plumbing pass.
// ──────────────────────────────────────────────────────────────

const TIMESTAMP_DB_NAME = "ados-signing-timestamps";
const TIMESTAMP_STORE_NAME = "signing-timestamps-v1";
let _tsStorePromise: ReturnType<typeof createStore> | null = null;
function timestampStore() {
  if (_tsStorePromise === null) {
    _tsStorePromise = createStore(TIMESTAMP_DB_NAME, TIMESTAMP_STORE_NAME);
  }
  return _tsStorePromise;
}

/**
 * Store the most recently emitted signing timestamp for this drone/link.
 * Called by the signer on a cadence (the active wiring runs from
 * requestIdleCallback when enabled).
 */
export async function saveTimestamp(
  droneId: string,
  linkId: number,
  timestamp: bigint,
): Promise<void> {
  const key = `${droneId}:${linkId}`;
  // BigInt is structured-cloneable, store directly.
  await set(key, timestamp, await timestampStore());
}

/**
 * Load the most recent persisted timestamp for this drone/link, or 0n
 * when nothing has been persisted yet.
 */
export async function loadTimestamp(
  droneId: string,
  linkId: number,
): Promise<bigint> {
  const key = `${droneId}:${linkId}`;
  const v = await get(key, await timestampStore());
  if (typeof v === "bigint") return v;
  return BigInt(0);
}
