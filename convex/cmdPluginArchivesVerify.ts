"use node";

/**
 * @module cmdPluginArchivesVerify
 * @description Node-runtime action that revalidates a freshly uploaded
 * `.adosplug` archive against client-supplied integrity claims before
 * the row is recorded in `plugin_archives`. Lives in its own file so
 * the surrounding mutations and queries can stay on the V8 runtime;
 * the verify path needs Node's `zlib` to inflate `manifest.yaml` out
 * of the zip when the entry is DEFLATE-compressed, which the default
 * Convex runtime does not expose.
 *
 * Threat model (server-supplied truth wins on every field):
 *
 * - `sha256` claim is compared against the storage layer's authoritative
 *   digest. The row records the storage value, never the client value.
 * - `manifestHash` claim is compared against the SHA-256 of the bytes
 *   the action extracted from the archive. The row records the server
 *   value. This closes the install-dialog swap where an operator
 *   approves one permission set and the agent installs another.
 * - `storageId` ownership is enforced against any prior registry row.
 *   The upload URL is single-use and authenticated, so a leaked id
 *   from another user's flow cannot be claimed here.
 *
 * @license GPL-3.0-only
 */

import { v } from "convex/values";
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";

import { action, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "./_generated/dataModel";

/** Largest manifest the verifier will read. Real manifests are a few KiB. */
const MANIFEST_MAX_BYTES = 256 * 1024;

// Cap on archive size we will stream + re-hash. Mirrors
// `ARCHIVE_MAX_BYTES` in the agent's archive parser.
const ARCHIVE_MAX_BYTES = 32 * 1024 * 1024;

// Filename the agent and the GCS both use for the canonical manifest
// entry inside `.adosplug` archives.
const MANIFEST_ENTRY_NAME = "manifest.yaml";

const declaredPermissionValidator = v.object({
  id: v.string(),
  required: v.boolean(),
});

/**
 * Verify a freshly uploaded archive and insert the registry row.
 *
 * Rejections (all thrown as `Error` so the install dialog renders a
 * single "Archive integrity check failed" line with the kernel text):
 *
 * - `storage object not owned by caller`
 * - `archive sha256 mismatch`
 * - `archive too large`
 * - `manifest missing` / `manifest hash mismatch`
 */
export const verifyArchive = action({
  args: {
    storageId: v.id("_storage"),
    fileName: v.string(),
    sizeBytes: v.number(),
    sha256: v.string(),
    pluginId: v.string(),
    version: v.string(),
    manifestHash: v.string(),
    declaredPermissions: v.array(declaredPermissionValidator),
    signerId: v.optional(v.string()),
    signatureB64: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"plugin_archives">> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // (1) Ownership. If any prior `plugin_archives` row already
    // claimed this storageId for a different user, refuse the new
    // claim. Convex `_storage` does not expose uploader info, so the
    // registry itself is the trust anchor.
    const priorClaim = await ctx.runQuery(
      internal.cmdPluginArchives._findByStorageId,
      { storageId: args.storageId },
    );
    if (priorClaim && priorClaim.userId !== userId) {
      throw new Error("storage object not owned by caller");
    }

    // (2)-(4) Integrity. A rejected upload is referenced by nothing, so it is
    // deleted here rather than left in storage where no one can find it. A
    // blob an existing row of this caller already holds is left alone.
    let checked: CheckedArchive;
    try {
      checked = await checkArchive(ctx, args.storageId, args.sha256, args.manifestHash);
    } catch (err) {
      if (!priorClaim) {
        await ctx.storage.delete(args.storageId).catch(() => undefined);
      }
      throw err;
    }

    // (5) All gates passed. Insert via the internal mutation. The row
    // carries server-computed hashes, never the client claims.
    return await ctx.runMutation(internal.cmdPluginArchives._insertArchive, {
      userId,
      storageId: args.storageId,
      fileName: args.fileName,
      sizeBytes: checked.sizeBytes,
      sha256: checked.sha256,
      pluginId: args.pluginId,
      version: args.version,
      manifestHash: checked.manifestHash,
      declaredPermissions: args.declaredPermissions,
      signerId: args.signerId,
      signatureB64: args.signatureB64,
    });
  },
});

/** The server-computed facts about an archive that passed every gate. */
interface CheckedArchive {
  sizeBytes: number;
  sha256: string;
  manifestHash: string;
}

/**
 * Verify a stored archive against the client's claims: size cap, storage-layer
 * (or recomputed) SHA-256, and the SHA-256 of the extracted manifest. Throws
 * with the documented rejection text on the first failed gate.
 */
async function checkArchive(
  ctx: ActionCtx,
  storageId: Id<"_storage">,
  claimedShaRaw: string,
  claimedManifestHash: string,
): Promise<CheckedArchive> {
  // (2) Storage-layer SHA-256.
  const meta = await ctx.storage.getMetadata(storageId);
  if (!meta) {
    throw new Error("storage object not found");
  }
  if (meta.size > ARCHIVE_MAX_BYTES) {
    throw new Error(
      `archive too large: ${meta.size} bytes (cap ${ARCHIVE_MAX_BYTES})`,
    );
  }

  const claimedSha = claimedShaRaw.toLowerCase();
  const storageSha = (meta.sha256 ?? "").toLowerCase();

  // (3) Stream the blob exactly once. We need the bytes for both
  // the (optional) fallback hash recompute and the manifest extract.
  const blob = await ctx.storage.get(storageId);
  if (!blob) {
    throw new Error("storage object not found");
  }
  const archiveBytes = Buffer.from(await blob.arrayBuffer());
  if (archiveBytes.byteLength > ARCHIVE_MAX_BYTES) {
    throw new Error(
      `archive too large: ${archiveBytes.byteLength} bytes (cap ${ARCHIVE_MAX_BYTES})`,
    );
  }
  if (storageSha) {
    if (storageSha !== claimedSha) {
      throw new Error("archive sha256 mismatch");
    }
  } else {
    // Self-host backends sometimes omit `sha256` on metadata; fall
    // back to recomputing from the bytes we just streamed.
    const streamedSha = createHash("sha256")
      .update(archiveBytes)
      .digest("hex");
    if (streamedSha !== claimedSha) {
      throw new Error("archive sha256 mismatch");
    }
  }

  // (4) Manifest hash.
  const manifestBytes = extractZipEntry(archiveBytes, MANIFEST_ENTRY_NAME);
  if (!manifestBytes) {
    throw new Error("manifest missing");
  }
  const serverManifestHash = createHash("sha256")
    .update(manifestBytes)
    .digest("hex");
  if (serverManifestHash !== claimedManifestHash.toLowerCase()) {
    throw new Error("manifest hash mismatch");
  }

  return {
    sizeBytes: meta.size,
    sha256: storageSha || claimedSha,
    manifestHash: serverManifestHash,
  };
}

// ──────────────────────────────────────────────────────────────
// Zip helpers (Node runtime)
// ──────────────────────────────────────────────────────────────

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const LOCAL_HEADER_SIGNATURE = 0x04034b50;

/**
 * Read a single entry out of an in-memory zip archive. Supports the
 * small subset of the zip spec the agent's writer emits: STORED
 * (method 0) or DEFLATE (method 8), no zip64, no encryption,
 * single disk. Returns the uncompressed entry bytes or `null` if the
 * entry is absent or unreadable.
 */
function extractZipEntry(
  archive: Buffer,
  entryName: string,
): Buffer | null {
  let eocdOffset = -1;
  const tailStart = Math.max(0, archive.byteLength - 65557);
  for (let i = archive.byteLength - 22; i >= tailStart; i -= 1) {
    if (archive.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) return null;
  const totalEntries = archive.readUInt16LE(eocdOffset + 10);
  const centralSize = archive.readUInt32LE(eocdOffset + 12);
  const centralOffset = archive.readUInt32LE(eocdOffset + 16);
  if (centralOffset + centralSize > archive.byteLength) return null;
  const targetBytes = Buffer.from(entryName, "utf-8");
  let cursor = centralOffset;
  for (let i = 0; i < totalEntries; i += 1) {
    if (cursor + 46 > archive.byteLength) return null;
    const sig = archive.readUInt32LE(cursor);
    if (sig !== CENTRAL_HEADER_SIGNATURE) return null;
    const method = archive.readUInt16LE(cursor + 10);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const uncompressedSize = archive.readUInt32LE(cursor + 24);
    const nameLen = archive.readUInt16LE(cursor + 28);
    const extraLen = archive.readUInt16LE(cursor + 30);
    const commentLen = archive.readUInt16LE(cursor + 32);
    const localHeaderOffset = archive.readUInt32LE(cursor + 42);
    const nameStart = cursor + 46;
    if (nameStart + nameLen > archive.byteLength) return null;
    const name = archive.subarray(nameStart, nameStart + nameLen);
    if (name.equals(targetBytes)) {
      if (localHeaderOffset + 30 > archive.byteLength) return null;
      const localSig = archive.readUInt32LE(localHeaderOffset);
      if (localSig !== LOCAL_HEADER_SIGNATURE) return null;
      const localNameLen = archive.readUInt16LE(localHeaderOffset + 26);
      const localExtraLen = archive.readUInt16LE(localHeaderOffset + 28);
      const dataStart =
        localHeaderOffset + 30 + localNameLen + localExtraLen;
      const dataEnd = dataStart + compressedSize;
      if (dataEnd > archive.byteLength) return null;
      const compressed = archive.subarray(dataStart, dataEnd);
      // The declared size comes from the uploaded file, so it only ever
      // tightens the bound: an entry declaring more than the fixed ceiling is
      // refused before any inflate, and the inflate itself stops at the
      // ceiling whatever the header claimed.
      if (uncompressedSize > MANIFEST_MAX_BYTES) return null;
      if (method === 0) {
        if (compressed.byteLength > MANIFEST_MAX_BYTES) return null;
        return Buffer.from(compressed);
      }
      if (method === 8) {
        try {
          return inflateRawSync(compressed, {
            maxOutputLength: MANIFEST_MAX_BYTES,
          });
        } catch {
          return null;
        }
      }
      return null;
    }
    cursor = nameStart + nameLen + extraLen + commentLen;
  }
  return null;
}
