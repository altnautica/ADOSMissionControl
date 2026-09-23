/**
 * @module plugins/archive-pin
 * @description Pins a plugin archive fetched by URL to the exact bytes the
 * operator installed, and refuses to run anything else.
 *
 * A GCS-only plugin installed without a cloud session keeps no copy of its
 * bundle: every mount re-fetches the published archive. Without a pin, a
 * release asset replaced after install would run under the permissions and
 * trust the operator granted to the original. At install the archive is
 * hashed and its signature verified; at every mount the fetched bytes must
 * hash to the pinned value and still verify under the pinned signer.
 *
 * @license GPL-3.0-only
 */

import JSZip from "jszip";

import {
  verifyArchiveSignature,
  type SignerKeyResolver,
} from "./archive-signature";
import { importEnrolledSignerKey } from "./signing-keys";

/** What an install pinned about its archive. */
export interface ArchivePin {
  /** Lowercase hex sha256 of the archive bytes. */
  sha256: string;
  /** The signer the archive verified under at install, or null if unsigned. */
  signerId: string | null;
}

/** Fetch a published archive through the same-origin release proxy. */
export async function fetchRegistryArchive(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Uint8Array> {
  const res = await fetchImpl(`/api/registry-archive?url=${encodeURIComponent(url)}`);
  if (!res.ok) throw new Error(`archive fetch failed: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
  let hex = "";
  for (const b of digest) hex += b.toString(16).padStart(2, "0");
  return hex;
}

/**
 * Verify an archive at install and return its pin. Throws when the bytes do
 * not match the hash the registry published, or the signature is invalid.
 */
export async function pinArchive(
  bytes: Uint8Array,
  opts: {
    expectedSha256?: string;
    manifestSignerId?: string | null;
    resolveKey?: SignerKeyResolver;
  } = {},
): Promise<ArchivePin> {
  const sha256 = await sha256Hex(bytes);
  const expected = opts.expectedSha256?.trim().toLowerCase();
  if (expected && expected !== sha256) {
    throw new Error("archive does not match the hash its registry entry publishes");
  }
  const zip = await JSZip.loadAsync(bytes);
  const signature = await verifyArchiveSignature(
    zip,
    opts.manifestSignerId,
    opts.resolveKey ?? importEnrolledSignerKey,
  );
  if (signature.state === "invalid") {
    throw new Error(`archive signature did not verify: ${signature.reason ?? "unknown reason"}`);
  }
  return { sha256, signerId: signature.verifiedSignerId ?? null };
}

/**
 * Open an archive fetched for a mount, refusing it unless it is the pinned
 * archive and still verifies under the pinned signer. A signed-at-install
 * archive that is now unsigned or signed by someone else is refused.
 */
export async function openPinnedArchive(
  bytes: Uint8Array,
  pin: ArchivePin,
  resolveKey: SignerKeyResolver = importEnrolledSignerKey,
): Promise<JSZip> {
  if ((await sha256Hex(bytes)) !== pin.sha256) {
    throw new Error("archive changed since it was installed; reinstall the plugin to accept it");
  }
  const zip = await JSZip.loadAsync(bytes);
  const signature = await verifyArchiveSignature(zip, pin.signerId, resolveKey);
  if (signature.state === "invalid") {
    throw new Error(`archive signature did not verify: ${signature.reason ?? "unknown reason"}`);
  }
  return zip;
}
