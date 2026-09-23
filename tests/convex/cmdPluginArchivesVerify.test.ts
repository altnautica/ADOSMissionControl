/**
 * Server-side integrity verifier for `.adosplug` plugin archives.
 *
 * `cmdPluginArchivesVerify.verifyArchive` is a Convex Node action that
 * cannot be executed without a Convex runtime, so the contract is
 * pinned in two layers:
 *
 *   1. Source-text contract — every documented rejection path,
 *      threshold, and validator declaration is asserted against the
 *      source. This catches a future refactor that quietly weakens
 *      the verifier (e.g. dropping the sha256 mismatch check).
 *
 *   2. Behavioral parity — the verifier's `extractZipEntry` helper is
 *      not exported, so we mirror its algorithm in this test file
 *      against real zip archives built with `jszip`. This documents
 *      the wire-format expectations and gives us a stable fixture
 *      shape for a future Convex-test-harness end-to-end test.
 *
 * Note: the algorithm mirror is intentionally close to the source.
 * If the source algorithm drifts, the mirror should drift with it in
 * the same PR; the text-contract tests will fail until both sides
 * are updated.
 */
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import JSZip from "jszip";
import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import * as verify from "../../convex/cmdPluginArchivesVerify";
import { invoke } from "./fakeConvexCtx";

const VERIFIER_PATH = path.join(
  process.cwd(),
  "convex/cmdPluginArchivesVerify.ts",
);

// ──────────────────────────────────────────────────────────────────
// Layer 1: source-text contract
// ──────────────────────────────────────────────────────────────────

describe("verifyArchive source contract", () => {
  it("runs on the Node runtime (uses node:zlib for DEFLATE)", async () => {
    const text = await readFile(VERIFIER_PATH, "utf8");
    expect(text.startsWith('"use node";')).toBe(true);
    expect(text).toContain('from "node:crypto"');
    expect(text).toContain('from "node:zlib"');
  });

  it("declares the full args validator surface", async () => {
    const text = await readFile(VERIFIER_PATH, "utf8");
    // Required claims that the agent + GCS install dialog must match.
    expect(text).toContain('storageId: v.id("_storage")');
    expect(text).toContain("fileName: v.string()");
    expect(text).toContain("sizeBytes: v.number()");
    expect(text).toContain("sha256: v.string()");
    expect(text).toContain("pluginId: v.string()");
    expect(text).toContain("version: v.string()");
    expect(text).toContain("manifestHash: v.string()");
    expect(text).toContain(
      "declaredPermissions: v.array(declaredPermissionValidator)",
    );
    expect(text).toContain("signerId: v.optional(v.string())");
    expect(text).toContain("signatureB64: v.optional(v.string())");
  });

  it("caps archive size at 32 MiB", async () => {
    const text = await readFile(VERIFIER_PATH, "utf8");
    expect(text).toContain("ARCHIVE_MAX_BYTES = 32 * 1024 * 1024");
    // Both the metadata path and the streamed-bytes path enforce the
    // cap. The defense-in-depth pair is the documented contract.
    const matches = text.match(/archive too large/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(2);
  });

  it("looks for the manifest under the canonical entry name", async () => {
    const text = await readFile(VERIFIER_PATH, "utf8");
    expect(text).toContain('MANIFEST_ENTRY_NAME = "manifest.yaml"');
  });

  it("declares every documented rejection path", async () => {
    const text = await readFile(VERIFIER_PATH, "utf8");
    const REJECTIONS = [
      "Not authenticated",
      "storage object not owned by caller",
      "storage object not found",
      "archive too large",
      "archive sha256 mismatch",
      "manifest missing",
      "manifest hash mismatch",
    ];
    for (const r of REJECTIONS) {
      expect(text, `must throw "${r}"`).toContain(r);
    }
  });

  it("compares SHA-256 case-insensitively (lowercases both sides)", async () => {
    const text = await readFile(VERIFIER_PATH, "utf8");
    expect(text).toContain("args.sha256.toLowerCase()");
    expect(text).toContain(".toLowerCase()");
  });

  it("falls back to recomputing sha256 when storage metadata omits it", async () => {
    const text = await readFile(VERIFIER_PATH, "utf8");
    // Self-host backends without sha256 in metadata must still be
    // verified. The fallback streams archiveBytes through node:crypto.
    expect(text).toContain('createHash("sha256")');
    expect(text).toContain(".update(archiveBytes)");
  });

  it("records the server-computed hashes on the inserted row (never client claims)", async () => {
    const text = await readFile(VERIFIER_PATH, "utf8");
    // The insert call passes serverManifestHash, NOT args.manifestHash.
    expect(text).toContain("manifestHash: serverManifestHash");
    // The sha256 written to the row prefers the storage value over the
    // client claim. (`storageSha || claimedSha` — storage wins when
    // present.)
    expect(text).toContain("sha256: storageSha || claimedSha");
  });

  it("only supports STORED and DEFLATE zip methods", async () => {
    const text = await readFile(VERIFIER_PATH, "utf8");
    expect(text).toContain("if (method === 0)");
    expect(text).toContain("if (method === 8)");
    // Unsupported methods return null (rejected upstream as "manifest
    // missing").
    expect(text).toContain("return null;");
  });

});

// ──────────────────────────────────────────────────────────────────
// Layer 2: behavioral parity — mirror of extractZipEntry on real
// archives. Kept close to the source so a future drift is obvious.
// ──────────────────────────────────────────────────────────────────

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const LOCAL_HEADER_SIGNATURE = 0x04034b50;

function extractZipEntryMirror(
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
      if (method === 0) return Buffer.from(compressed);
      if (method === 8) {
        // Lazy-require so the mirror stays close to the source shape.
        const { inflateRawSync } = require("node:zlib");
        try {
          return inflateRawSync(compressed);
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

/**
 * Simulate the verifier's gate sequence on a known-shape archive. We
 * don't run the Convex action; we run the same logic the action runs
 * to assert the archive shape would survive (or fail) verification.
 */
type VerifyOutcome =
  | { ok: true; serverManifestHash: string }
  | { ok: false; reason: string };

function simulateVerify(input: {
  archiveBytes: Buffer;
  claimedSha256: string;
  claimedManifestHash: string;
  maxBytes?: number;
}): VerifyOutcome {
  const cap = input.maxBytes ?? 32 * 1024 * 1024;
  if (input.archiveBytes.byteLength > cap) {
    return { ok: false, reason: "archive too large" };
  }
  const streamedSha = createHash("sha256")
    .update(input.archiveBytes)
    .digest("hex");
  if (streamedSha !== input.claimedSha256.toLowerCase()) {
    return { ok: false, reason: "archive sha256 mismatch" };
  }
  const manifest = extractZipEntryMirror(input.archiveBytes, "manifest.yaml");
  if (!manifest) {
    return { ok: false, reason: "manifest missing" };
  }
  const serverManifestHash = createHash("sha256")
    .update(manifest)
    .digest("hex");
  if (serverManifestHash !== input.claimedManifestHash.toLowerCase()) {
    return { ok: false, reason: "manifest hash mismatch" };
  }
  return { ok: true, serverManifestHash };
}

async function buildArchive(options: {
  manifestBody?: string | null;
  extraFiles?: Record<string, string>;
  compress?: boolean;
}): Promise<Buffer> {
  const zip = new JSZip();
  if (options.manifestBody !== null && options.manifestBody !== undefined) {
    zip.file("manifest.yaml", options.manifestBody);
  }
  for (const [name, body] of Object.entries(options.extraFiles ?? {})) {
    zip.file(name, body);
  }
  const buf = await zip.generateAsync({
    type: "nodebuffer",
    compression: options.compress ? "DEFLATE" : "STORE",
    compressionOptions: { level: 6 },
  });
  return Buffer.from(buf);
}

describe("verifier behavior on real archives", () => {
  it("accepts a STORED archive whose manifest hash matches the claim", async () => {
    const manifestBody = "id: ados.test\nversion: 0.1.0\n";
    const archive = await buildArchive({ manifestBody, compress: false });
    const sha256 = createHash("sha256").update(archive).digest("hex");
    const manifestHash = createHash("sha256")
      .update(manifestBody)
      .digest("hex");
    const outcome = simulateVerify({
      archiveBytes: archive,
      claimedSha256: sha256,
      claimedManifestHash: manifestHash,
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.serverManifestHash).toBe(manifestHash);
    }
  });

  it("accepts a DEFLATE archive whose manifest hash matches the claim", async () => {
    // Repeating body so DEFLATE actually produces method=8 entries.
    const manifestBody = "id: ados.test\n".repeat(200);
    const archive = await buildArchive({ manifestBody, compress: true });
    const sha256 = createHash("sha256").update(archive).digest("hex");
    const manifestHash = createHash("sha256")
      .update(manifestBody)
      .digest("hex");
    const outcome = simulateVerify({
      archiveBytes: archive,
      claimedSha256: sha256,
      claimedManifestHash: manifestHash,
    });
    expect(outcome.ok).toBe(true);
  });

  it("rejects an archive with a tampered manifest (hash mismatch)", async () => {
    const realManifest = "id: ados.test\nversion: 0.1.0\n";
    const tamperedManifest = "id: ados.evil\nversion: 0.1.0\n";
    const archive = await buildArchive({
      manifestBody: realManifest,
      compress: false,
    });
    const sha256 = createHash("sha256").update(archive).digest("hex");
    // Operator approved a hash for a DIFFERENT manifest.
    const claimedManifestHash = createHash("sha256")
      .update(tamperedManifest)
      .digest("hex");
    const outcome = simulateVerify({
      archiveBytes: archive,
      claimedSha256: sha256,
      claimedManifestHash,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("manifest hash mismatch");
  });

  it("rejects an archive that does not contain manifest.yaml at the root", async () => {
    const archive = await buildArchive({
      manifestBody: null,
      extraFiles: { "src/agent.py": "print('hi')\n" },
      compress: false,
    });
    const sha256 = createHash("sha256").update(archive).digest("hex");
    const outcome = simulateVerify({
      archiveBytes: archive,
      claimedSha256: sha256,
      claimedManifestHash: createHash("sha256").update("").digest("hex"),
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("manifest missing");
  });

  it("rejects an archive whose declared sha256 does not match the bytes", async () => {
    const archive = await buildArchive({
      manifestBody: "id: ados.test\n",
      compress: false,
    });
    const wrongSha = "0".repeat(64);
    const outcome = simulateVerify({
      archiveBytes: archive,
      claimedSha256: wrongSha,
      claimedManifestHash: createHash("sha256")
        .update("id: ados.test\n")
        .digest("hex"),
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("archive sha256 mismatch");
  });

  it("rejects an archive larger than the configured cap", async () => {
    const archive = await buildArchive({
      manifestBody: "id: ados.test\n",
      compress: false,
    });
    const sha256 = createHash("sha256").update(archive).digest("hex");
    const outcome = simulateVerify({
      archiveBytes: archive,
      claimedSha256: sha256,
      claimedManifestHash: createHash("sha256")
        .update("id: ados.test\n")
        .digest("hex"),
      maxBytes: 16, // absurdly small to force the cap
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("archive too large");
  });

  it("returns null on a buffer that is not a zip archive at all", () => {
    const notAZip = Buffer.from("This is not a zip file", "utf-8");
    const out = extractZipEntryMirror(notAZip, "manifest.yaml");
    expect(out).toBeNull();
  });

  it("returns null on an empty buffer", () => {
    const empty = Buffer.alloc(0);
    const out = extractZipEntryMirror(empty, "manifest.yaml");
    expect(out).toBeNull();
  });

  it("returns null when the requested entry is absent", async () => {
    const archive = await buildArchive({
      manifestBody: "id: ados.test\n",
      compress: false,
    });
    const out = extractZipEntryMirror(archive, "definitely-missing.txt");
    expect(out).toBeNull();
  });
});

describe("verifyArchive manifest inflate bound", () => {
  /** A one-entry zip whose central header declares `declaredSize`. */
  function zipWith(name: string, data: Buffer, declaredSize: number): Buffer {
    const compressed = deflateRawSync(data);
    const nameBytes = Buffer.from(name, "utf-8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(compressed.byteLength, 18);
    local.writeUInt32LE(declaredSize, 22);
    local.writeUInt16LE(nameBytes.byteLength, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(compressed.byteLength, 20);
    central.writeUInt32LE(declaredSize, 24);
    central.writeUInt16LE(nameBytes.byteLength, 28);
    central.writeUInt32LE(0, 42);
    const centralOffset = local.byteLength + nameBytes.byteLength + compressed.byteLength;
    const centralSize = central.byteLength + nameBytes.byteLength;
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 8);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(centralSize, 12);
    eocd.writeUInt32LE(centralOffset, 16);
    return Buffer.concat([local, nameBytes, compressed, central, nameBytes, eocd]);
  }

  function actionCtx(archive: Buffer) {
    return {
      auth: { getUserIdentity: async () => ({ subject: "user-1|session-1" }) },
      runQuery: async () => null,
      runMutation: async () => "archive-row-id",
      storage: {
        getMetadata: async () => ({ size: archive.byteLength, sha256: sha256(archive) }),
        get: async () => new Blob([new Uint8Array(archive)]),
      },
    };
  }

  function sha256(bytes: Buffer): string {
    return createHash("sha256").update(bytes).digest("hex");
  }

  function args(archive: Buffer, manifest: Buffer) {
    return {
      storageId: "storage-1",
      fileName: "p.adosplug",
      sizeBytes: archive.byteLength,
      sha256: sha256(archive),
      pluginId: "p",
      version: "1.0.0",
      manifestHash: sha256(manifest),
      declaredPermissions: [],
    };
  }

  it("refuses a manifest whose declared size exceeds the fixed ceiling, without inflating it", async () => {
    const bomb = Buffer.alloc(8 * 1024 * 1024);
    const archive = zipWith("manifest.yaml", bomb, 0xffffffff);
    await expect(
      invoke(verify.verifyArchive, actionCtx(archive), args(archive, bomb)),
    ).rejects.toThrow(/manifest missing/);
  });

  it("stops inflating at the ceiling even when the declared size is small", async () => {
    const bomb = Buffer.alloc(8 * 1024 * 1024);
    const archive = zipWith("manifest.yaml", bomb, 100);
    await expect(
      invoke(verify.verifyArchive, actionCtx(archive), args(archive, bomb)),
    ).rejects.toThrow(/manifest missing/);
  });

  it("accepts an ordinary manifest", async () => {
    const manifest = Buffer.from("id: p\nversion: 1.0.0\n");
    const archive = zipWith("manifest.yaml", manifest, manifest.byteLength);
    await expect(
      invoke(verify.verifyArchive, actionCtx(archive), args(archive, manifest)),
    ).resolves.toBe("archive-row-id");
  });
});
