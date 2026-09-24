/**
 * @module plugins/inline-trust
 * @description The gate an inline GCS module passes before it is imported
 * into the host page. An inline module runs in Mission Control's own realm
 * with no sandbox, so trust is established here from the plugin's signed
 * contents and never from a row field (the Convex `signerId` column, an
 * agent detail, a registry entry).
 *
 * A module is admitted only when all of these hold:
 *   1. The `SIGNATURE` text verifies over the signed file digests.
 *   2. The signer is an enrolled first-party signer.
 *   3. `manifest.yaml` hashes to its signed digest, names this plugin, and
 *      declares `gcs.isolation: inline` with this entrypoint.
 *   4. The module bytes hash to the signed digest for the entrypoint.
 *
 * Two sources reach it: the node agent's attestation (the installed plugin's
 * signature plus its file digests) and a pinned published archive.
 *
 * @license GPL-3.0-only
 */

import type JSZip from "jszip";

import {
  SIGNATURE_ENTRY,
  verifySignatureOverDigests,
  type FileDigest,
  type SignerKeyResolver,
} from "./archive-signature";
import { openPinnedArchive, sha256Hex, type ArchivePin } from "./archive-pin";
import { importEnrolledSignerKey, isEnrolledFirstPartySigner } from "./signing-keys";
import { parseManifestYaml } from "@/components/plugins/transports/manifest-parse";

/**
 * The installed plugin's signature and file digests, as the node agent
 * reports them. Entries flagged `payload` were downloaded after install and
 * are trusted through the signed manifest, not the signature, so they never
 * vouch for the module or the manifest.
 */
export interface InlineAttestation {
  /** The `SIGNATURE` entry text, or null when the archive was unsigned. */
  signature: string | null;
  files: ReadonlyArray<FileDigest & { payload?: boolean }>;
}

/** What a verified inline module is trusted as. */
export interface InlineTrust {
  pluginId: string;
  version: string;
  signerId: string;
  /** Archive-relative entrypoint path of the module. */
  entrypoint: string;
  /** Signed archive entry paths, for locating companion assets (stylesheet). */
  paths: ReadonlyArray<string>;
}

export type InlineTrustErrorCode =
  | "attestation_malformed"
  | "signature_invalid"
  | "signer_not_first_party"
  | "manifest_mismatch"
  | "not_inline"
  | "module_mismatch";

export class InlineTrustError extends Error {
  readonly code: InlineTrustErrorCode;
  constructor(code: InlineTrustErrorCode, message: string) {
    super(message);
    this.name = "InlineTrustError";
    this.code = code;
  }
}

/** Injection points for tests; production uses the enrolled key table. */
export interface InlineTrustDeps {
  resolveKey?: SignerKeyResolver;
  isFirstPartySigner?: (signerId: string) => boolean;
}

/** Strip a leading `./` so a manifest path and a digest path compare equal. */
function normalizePath(path: string): string {
  return path.replace(/^\.\//, "");
}

/** Narrow an agent reply to an attestation, or throw `attestation_malformed`. */
export function parseInlineAttestation(value: unknown): InlineAttestation {
  const bad = () =>
    new InlineTrustError("attestation_malformed", "the node returned a malformed attestation");
  if (typeof value !== "object" || value === null) throw bad();
  const v = value as Record<string, unknown>;
  if (v.signature !== null && typeof v.signature !== "string") throw bad();
  if (!Array.isArray(v.files)) throw bad();
  const files = v.files.map((f: unknown) => {
    if (typeof f !== "object" || f === null) throw bad();
    const e = f as Record<string, unknown>;
    if (typeof e.path !== "string" || typeof e.sha256 !== "string") throw bad();
    return { path: e.path, sha256: e.sha256, ...(e.payload === true ? { payload: true } : {}) };
  });
  return { signature: v.signature, files };
}

/**
 * Check a verified manifest's own claims (condition 3 minus the digest):
 * it names `pluginId`, declares inline isolation and declares `entrypoint`.
 * Returns the manifest version.
 */
function checkInlineManifest(manifestText: string, pluginId: string, entrypoint: string): string {
  const parsed = parseManifestYaml(manifestText);
  if (parsed.pluginId !== pluginId) {
    throw new InlineTrustError(
      "manifest_mismatch",
      `the signed manifest is for "${parsed.pluginId}", not "${pluginId}"`,
    );
  }
  if (parsed.gcsIsolation !== "inline") {
    throw new InlineTrustError(
      "not_inline",
      "the signed manifest does not declare gcs.isolation: inline",
    );
  }
  if (!parsed.gcsEntrypoint || normalizePath(parsed.gcsEntrypoint) !== entrypoint) {
    throw new InlineTrustError(
      "manifest_mismatch",
      `the signed manifest does not declare ${entrypoint} as its GCS entrypoint`,
    );
  }
  return parsed.version;
}

/**
 * Verify a module fetched from a node agent against that agent's attestation.
 * Resolves the trust it is admitted under; throws `InlineTrustError` otherwise.
 */
export async function verifyInlineModule(
  input: {
    pluginId: string;
    entrypoint: string;
    moduleBytes: Uint8Array;
    manifestBytes: Uint8Array;
    attestation: InlineAttestation;
  },
  deps: InlineTrustDeps = {},
): Promise<InlineTrust> {
  const { pluginId, attestation } = input;
  const entrypoint = normalizePath(input.entrypoint);
  const isFirstParty = deps.isFirstPartySigner ?? isEnrolledFirstPartySigner;
  if (attestation.signature === null) {
    throw new InlineTrustError("signature_invalid", "the installed plugin is unsigned");
  }
  const signed: FileDigest[] = attestation.files
    .filter((f) => f.payload !== true)
    .map((f) => ({ path: f.path, sha256: f.sha256 }));

  const verdict = await verifySignatureOverDigests(
    attestation.signature,
    signed,
    deps.resolveKey ?? importEnrolledSignerKey,
  );
  if (verdict.state !== "verified" || !verdict.verifiedSignerId) {
    throw new InlineTrustError(
      "signature_invalid",
      verdict.reason ?? "the plugin signature did not verify",
    );
  }
  const signerId = verdict.verifiedSignerId;
  if (!isFirstParty(signerId)) {
    throw new InlineTrustError(
      "signer_not_first_party",
      `signer "${signerId}" may not run an inline module`,
    );
  }

  const digestOf = (path: string) => signed.find((f) => f.path === path)?.sha256;
  const manifestDigest = digestOf("manifest.yaml");
  if (!manifestDigest || manifestDigest !== (await sha256Hex(input.manifestBytes))) {
    throw new InlineTrustError(
      "manifest_mismatch",
      "manifest.yaml does not match its signed digest",
    );
  }
  const version = checkInlineManifest(
    new TextDecoder().decode(input.manifestBytes),
    pluginId,
    entrypoint,
  );

  const moduleDigest = digestOf(entrypoint);
  if (!moduleDigest || moduleDigest !== (await sha256Hex(input.moduleBytes))) {
    throw new InlineTrustError(
      "module_mismatch",
      `${entrypoint} does not match its signed digest`,
    );
  }
  return { pluginId, version, signerId, entrypoint, paths: signed.map((f) => f.path) };
}

/**
 * Open a pinned published archive and extract its inline module. The archive
 * must be the pinned bytes, still verify under the pinned signer, and that
 * signer must be first-party; its manifest must declare this inline module.
 * Resolves the opened archive too, so companion assets are read from the
 * same verified bytes.
 */
export async function verifyInlineArchive(
  input: {
    pluginId: string;
    entrypoint: string;
    archiveBytes: Uint8Array;
    pin: ArchivePin;
  },
  deps: InlineTrustDeps = {},
): Promise<{ moduleBytes: Uint8Array; trust: InlineTrust; zip: JSZip }> {
  const { pluginId, pin } = input;
  const entrypoint = normalizePath(input.entrypoint);
  const isFirstParty = deps.isFirstPartySigner ?? isEnrolledFirstPartySigner;
  if (!pin.signerId || !isFirstParty(pin.signerId)) {
    throw new InlineTrustError(
      "signer_not_first_party",
      "only a first-party signed archive may run an inline module",
    );
  }
  const zip = await openPinnedArchive(
    input.archiveBytes,
    pin,
    deps.resolveKey ?? importEnrolledSignerKey,
  );
  const manifest = zip.file("manifest.yaml");
  const moduleEntry = zip.file(entrypoint);
  if (!manifest || !moduleEntry) {
    throw new InlineTrustError("module_mismatch", `the archive is missing ${entrypoint}`);
  }
  const version = checkInlineManifest(await manifest.async("string"), pluginId, entrypoint);
  const paths = Object.values(zip.files)
    .filter((e) => !e.dir && e.name !== SIGNATURE_ENTRY)
    .map((e) => e.name);
  return {
    moduleBytes: await moduleEntry.async("uint8array"),
    trust: { pluginId, version, signerId: pin.signerId, entrypoint, paths },
    zip,
  };
}
