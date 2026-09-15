/**
 * @module plugins/archive-signature
 * @description Ed25519 verification of a `.adosplug` archive on the GCS.
 *
 * This is the ONLY place a plugin's trust state is established. Everything
 * downstream — the install-dialog badges, the plugin cards, the MCP tab, the
 * `signerId` written onto the install row — consumes the
 * {@link PluginSignatureState} this module returns and never re-derives trust
 * from a string inside the archive.
 *
 * ## Wire format (must match the agent byte for byte)
 *
 * The packer (`ados plugin sign`) appends one entry named `SIGNATURE` holding
 * two newline-separated lines: the signer id, then the base64 raw 64-byte
 * Ed25519 signature. The signed payload is NOT the archive bytes — it is the
 * canonical payload hash:
 *
 *   sha256( for each non-SIGNATURE entry, sorted by path:
 *             "<path>\n" + hex(sha256(entry bytes)) + "\n" )
 *
 * and the signature is over those 32 raw digest bytes, so verification cost is
 * independent of archive size. `ados.plugins.archive._canonical_payload_hash`
 * and `ados.plugins.signing.verify_archive_signature` are the authorities; a
 * change on either side breaks both.
 *
 * ## Why the manifest's own `signer_id` cannot be trusted
 *
 * `manifest.yaml` lives inside the archive the operator supplied, so a
 * `signer_id:` line there is an unauthenticated claim. It is read here only to
 * *contradict* the archive: a manifest that names a signer the `SIGNATURE`
 * entry does not back resolves `"invalid"` and is refused at install.
 *
 * @license GPL-3.0-only
 */

import type JSZip from "jszip";

import { importEnrolledSignerKey } from "./signing-keys";

/** Archive entry carrying the detached signature. */
export const SIGNATURE_ENTRY = "SIGNATURE";

/**
 * The verification outcome for one archive.
 *
 *   * `verified`   — a `SIGNATURE` entry verified under an enrolled public key.
 *                    The only state that may produce a trust badge.
 *   * `unsigned`   — no `SIGNATURE` entry and no manifest signer claim. Allowed
 *                    (developer builds), badge-less.
 *   * `invalid`    — a signature or signer claim is present and does not hold:
 *                    unknown signer, malformed entry, bad signature, or a
 *                    manifest claim the archive does not back. Refused.
 *   * `unverified` — the GCS never held the bytes (registry preview, agent-side
 *                    parse). Badge-less; the install path verifies later.
 */
export type PluginSignatureState =
  | "verified"
  | "unsigned"
  | "invalid"
  | "unverified";

export interface ArchiveSignatureResult {
  state: PluginSignatureState;
  /**
   * The signer id the signature actually verified under. Set ONLY when
   * `state === "verified"` — never echoed from an unverified claim, so a
   * consumer that writes this onto a row cannot persist a fabricated signer.
   */
  verifiedSignerId?: string;
  /** Operator-facing reason. Always set for `invalid`. */
  reason?: string;
}

/** A path that would escape the install directory, or a Windows separator. */
function isUnsafeEntryPath(name: string): boolean {
  if (name.startsWith("/") || name.includes("\\")) return true;
  return name.split("/").some((seg) => seg === ".." || seg.startsWith(".."));
}

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
}

/**
 * Compute the agent's canonical payload hash over every non-`SIGNATURE` file
 * entry of a loaded archive. Directory entries are skipped, exactly as the
 * agent's `parse_archive_bytes` skips names ending in `/`.
 *
 * Throws on an unsafe entry path so a traversal attempt is a refusal rather
 * than a silently different hash.
 */
export async function canonicalPayloadHash(zip: JSZip): Promise<Uint8Array> {
  const paths: string[] = [];
  zip.forEach((relativePath, entry) => {
    if (entry.dir) return;
    paths.push(relativePath);
  });
  for (const p of paths) {
    if (isUnsafeEntryPath(p)) {
      throw new Error(`unsafe archive entry path: ${p}`);
    }
  }
  paths.sort();
  const parts: string[] = [];
  for (const path of paths) {
    if (path === SIGNATURE_ENTRY) continue;
    const entry = zip.file(path);
    if (!entry) continue;
    const bytes = await entry.async("uint8array");
    parts.push(`${path}\n${toHex(await sha256(bytes))}\n`);
  }
  return sha256(new TextEncoder().encode(parts.join("")));
}

/** Parse the two-line `SIGNATURE` body. Returns null when it is malformed. */
function parseSignatureEntry(
  text: string,
): { signerId: string; signatureB64: string } | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length !== 2) return null;
  return { signerId: lines[0], signatureB64: lines[1] };
}

/**
 * Resolves the verify key for a signer id, or `null` when that signer is not
 * trusted. The default is {@link importEnrolledSignerKey}, i.e. the vendored
 * enrolled-key table; the parameter exists so the conformance test can verify
 * against the agent's interop keypair without enrolling a test key in the
 * production table.
 */
export type SignerKeyResolver = (
  signerId: string,
) => Promise<CryptoKey | null>;

/**
 * Verify a loaded `.adosplug` archive.
 *
 * `manifestSignerId` is the unauthenticated `signer_id` from `manifest.yaml`
 * (or from a registry row). Pass it so a claim the archive cannot back is
 * reported as `invalid` instead of quietly downgrading to `unsigned`.
 *
 * Never throws for a bad archive — every failure is an `invalid` result with a
 * reason, so a caller cannot accidentally treat a thrown error as a pass.
 */
export async function verifyArchiveSignature(
  zip: JSZip,
  manifestSignerId?: string | null,
  resolveKey: SignerKeyResolver = importEnrolledSignerKey,
): Promise<ArchiveSignatureResult> {
  const claimed = manifestSignerId?.trim() || undefined;
  const sigEntry = zip.file(SIGNATURE_ENTRY);

  if (!sigEntry) {
    if (claimed) {
      return {
        state: "invalid",
        reason: `manifest declares signer "${claimed}" but the archive carries no ${SIGNATURE_ENTRY} entry`,
      };
    }
    return { state: "unsigned" };
  }

  try {
    const parsed = parseSignatureEntry(await sigEntry.async("string"));
    if (!parsed) {
      return {
        state: "invalid",
        reason: `${SIGNATURE_ENTRY} must hold two non-blank lines (signer id, then base64 signature)`,
      };
    }
    const { signerId, signatureB64 } = parsed;
    if (claimed && claimed !== signerId) {
      return {
        state: "invalid",
        reason: `manifest declares signer "${claimed}" but the archive is signed by "${signerId}"`,
      };
    }

    const key = await resolveKey(signerId);
    if (!key) {
      return {
        state: "invalid",
        reason: `signer "${signerId}" is not an enrolled plugin signing key`,
      };
    }

    let signature: Uint8Array;
    try {
      signature = base64ToBytes(signatureB64);
    } catch {
      return {
        state: "invalid",
        reason: `${SIGNATURE_ENTRY} signature is not valid base64`,
      };
    }
    if (signature.byteLength !== 64) {
      return {
        state: "invalid",
        reason: `signature is ${signature.byteLength} bytes; an Ed25519 signature is 64`,
      };
    }

    const payload = await canonicalPayloadHash(zip);
    const sigBuf = new ArrayBuffer(signature.byteLength);
    new Uint8Array(sigBuf).set(signature);
    const payloadBuf = new ArrayBuffer(payload.byteLength);
    new Uint8Array(payloadBuf).set(payload);
    const ok = await crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      sigBuf,
      payloadBuf,
    );
    if (!ok) {
      return {
        state: "invalid",
        reason: `archive contents do not match the signature from "${signerId}"`,
      };
    }
    return { state: "verified", verifiedSignerId: signerId };
  } catch (err) {
    return {
      state: "invalid",
      reason: `signature verification failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
