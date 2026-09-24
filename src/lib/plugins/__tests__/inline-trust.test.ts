/**
 * The inline trust gate: a module is admitted only when the node's
 * attestation signature verifies under a first-party signer, the signed
 * manifest declares this inline entrypoint, and the module bytes match their
 * signed digest. A throwaway Ed25519 key stands in for the enrolled table
 * through the injectable resolver and first-party predicate.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeAll } from "vitest";

import { canonicalHashFromDigests, type FileDigest } from "../archive-signature";
import { sha256Hex } from "../archive-pin";
import {
  InlineTrustError,
  verifyInlineModule,
  type InlineAttestation,
  type InlineTrustDeps,
} from "../inline-trust";

const SIGNER = "test-signer-A";
const PLUGIN_ID = "com.example.inline";
const ENTRY = "gcs/inline.mjs";
const MODULE = new TextEncoder().encode("export default { mount() { return () => {}; } };");

let keys: CryptoKeyPair;

beforeAll(async () => {
  keys = (await crypto.subtle.generateKey({ name: "Ed25519" }, false, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
});

function manifest(isolation: "inline" | "iframe"): Uint8Array {
  return new TextEncoder().encode(
    `id: ${PLUGIN_ID}\nversion: 1.2.3\nname: Inline\ngcs:\n  entrypoint: ${ENTRY}\n  isolation: ${isolation}\n`,
  );
}

function toBuffer(bytes: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return buf;
}

/** Sign the given files the way the packer does and return the attestation. */
async function attest(files: Array<{ path: string; bytes: Uint8Array }>): Promise<InlineAttestation> {
  const digests: FileDigest[] = [];
  for (const f of files) digests.push({ path: f.path, sha256: await sha256Hex(f.bytes) });
  const payload = await canonicalHashFromDigests(digests);
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: "Ed25519" }, keys.privateKey, toBuffer(payload)),
  );
  return { signature: `${SIGNER}\n${btoa(String.fromCharCode(...sig))}\n`, files: digests };
}

const deps = (firstParty: boolean): InlineTrustDeps => ({
  resolveKey: async (id) => (id === SIGNER ? keys.publicKey : null),
  isFirstPartySigner: (id) => firstParty && id === SIGNER,
});

async function expectRefusal(pending: Promise<unknown>, code: InlineTrustError["code"]) {
  const err = await pending.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(InlineTrustError);
  expect((err as InlineTrustError).code).toBe(code);
}

describe("verifyInlineModule", () => {
  it("admits a first-party signed inline module and reports its signer and version", async () => {
    const manifestBytes = manifest("inline");
    const attestation = await attest([
      { path: "manifest.yaml", bytes: manifestBytes },
      { path: ENTRY, bytes: MODULE },
    ]);
    const trust = await verifyInlineModule(
      { pluginId: PLUGIN_ID, entrypoint: ENTRY, moduleBytes: MODULE, manifestBytes, attestation },
      deps(true),
    );
    expect(trust).toMatchObject({ pluginId: PLUGIN_ID, version: "1.2.3", signerId: SIGNER, entrypoint: ENTRY });
  });

  it("refuses a signature that verifies under a signer that is not first-party", async () => {
    const manifestBytes = manifest("inline");
    const attestation = await attest([
      { path: "manifest.yaml", bytes: manifestBytes },
      { path: ENTRY, bytes: MODULE },
    ]);
    await expectRefusal(
      verifyInlineModule(
        { pluginId: PLUGIN_ID, entrypoint: ENTRY, moduleBytes: MODULE, manifestBytes, attestation },
        deps(false),
      ),
      "signer_not_first_party",
    );
  });

  it("refuses module bytes that do not match the signed digest", async () => {
    const manifestBytes = manifest("inline");
    const attestation = await attest([
      { path: "manifest.yaml", bytes: manifestBytes },
      { path: ENTRY, bytes: MODULE },
    ]);
    const swapped = new TextEncoder().encode("export default { mount() { steal(); } };");
    await expectRefusal(
      verifyInlineModule(
        { pluginId: PLUGIN_ID, entrypoint: ENTRY, moduleBytes: swapped, manifestBytes, attestation },
        deps(true),
      ),
      "module_mismatch",
    );
  });

  it("refuses a signed manifest that declares the iframe isolation", async () => {
    const manifestBytes = manifest("iframe");
    const attestation = await attest([
      { path: "manifest.yaml", bytes: manifestBytes },
      { path: ENTRY, bytes: MODULE },
    ]);
    await expectRefusal(
      verifyInlineModule(
        { pluginId: PLUGIN_ID, entrypoint: ENTRY, moduleBytes: MODULE, manifestBytes, attestation },
        deps(true),
      ),
      "not_inline",
    );
  });
});
