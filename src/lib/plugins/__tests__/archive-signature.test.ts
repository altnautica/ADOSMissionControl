/**
 * @license GPL-3.0-only
 *
 * Trust is a verification result, never a claim.
 *
 * Two contracts are pinned here:
 *
 *   1. **Conformance.** The canonical payload hash this module computes must
 *      equal the one the agent computes over the same archive. If the two ever
 *      diverge, the GCS refuses every genuinely signed archive while still
 *      passing all the negative cases below — so this assertion is what makes
 *      the rest of the suite meaningful.
 *   2. **Refusal.** An archive that declares a signer it cannot back, names an
 *      unenrolled signer, or carries a signature over different bytes resolves
 *      `invalid`, and no signature-derived trust signal is emitted for anything
 *      other than `verified`.
 */

import { describe, it, expect } from "vitest";
import JSZip from "jszip";

import {
  canonicalPayloadHash,
  verifyArchiveSignature,
  type SignerKeyResolver,
} from "../archive-signature";
import { deriveTrustSignals, displayTrustSignals } from "../trust-signals";
import { importEnrolledSignerKey } from "../signing-keys";
import fixture from "./fixtures/signed-archive.json";

const MANIFEST_WITH_SIGNER = `id: com.example.claimant
version: 1.0.0
name: Claimant
signer_id: altnautica-2026-A
gcs:
  entrypoint: gcs/plugin.bundle.js
`;

const MANIFEST_NO_SIGNER = `id: com.example.plain
version: 1.0.0
name: Plain
gcs:
  entrypoint: gcs/plugin.bundle.js
`;

function bytesFromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Load the agent-generated conformance archive. */
async function loadFixtureArchive(): Promise<JSZip> {
  return JSZip.loadAsync(bytesFromBase64(fixture.archiveB64));
}

/** Resolver bound to the conformance fixture's throwaway keypair. */
const fixtureKeyResolver: SignerKeyResolver = async (signerId) => {
  if (signerId !== fixture.signerId) return null;
  const der = bytesFromBase64(fixture.signerSpkiBase64);
  const buf = new ArrayBuffer(der.byteLength);
  new Uint8Array(buf).set(der);
  return crypto.subtle.importKey("spki", buf, { name: "Ed25519" }, false, [
    "verify",
  ]);
};

/** Build an archive with the given manifest text and optional SIGNATURE body. */
async function buildArchive(opts: {
  manifest: string;
  signature?: string;
  bundle?: string;
}): Promise<JSZip> {
  const zip = new JSZip();
  zip.file("manifest.yaml", opts.manifest);
  zip.file("gcs/plugin.bundle.js", opts.bundle ?? "export default {};");
  if (opts.signature !== undefined) zip.file("SIGNATURE", opts.signature);
  return JSZip.loadAsync(await zip.generateAsync({ type: "uint8array" }));
}

describe("canonicalPayloadHash · agrees with the agent", () => {
  it("reproduces the agent's canonical payload hash for the same archive", async () => {
    const zip = await loadFixtureArchive();
    expect(hex(await canonicalPayloadHash(zip))).toBe(fixture.payloadHashHex);
  });

  it("changes when any entry's bytes change", async () => {
    const zip = await loadFixtureArchive();
    const before = hex(await canonicalPayloadHash(zip));
    zip.file("assets/model.bin", "tampered");
    expect(hex(await canonicalPayloadHash(zip))).not.toBe(before);
  });

  it("ignores the SIGNATURE entry, so signing does not change the payload", async () => {
    const zip = await loadFixtureArchive();
    const before = hex(await canonicalPayloadHash(zip));
    zip.file("SIGNATURE", `${fixture.signerId}\n${fixture.signatureB64}\n`);
    expect(hex(await canonicalPayloadHash(zip))).toBe(before);
  });
});

describe("verifyArchiveSignature · a real signature verifies", () => {
  it("accepts the agent's signature and reports the signer that verified", async () => {
    const zip = await loadFixtureArchive();
    zip.file("SIGNATURE", `${fixture.signerId}\n${fixture.signatureB64}\n`);
    const result = await verifyArchiveSignature(zip, null, fixtureKeyResolver);
    expect(result.state).toBe("verified");
    expect(result.verifiedSignerId).toBe(fixture.signerId);
  });

  it("rejects a one-bit-tampered signature over the same bytes", async () => {
    const zip = await loadFixtureArchive();
    zip.file(
      "SIGNATURE",
      `${fixture.signerId}\n${fixture.tamperedSignatureB64}\n`,
    );
    const result = await verifyArchiveSignature(zip, null, fixtureKeyResolver);
    expect(result.state).toBe("invalid");
    expect(result.verifiedSignerId).toBeUndefined();
  });

  it("rejects a valid signature once the archive contents change", async () => {
    const zip = await loadFixtureArchive();
    zip.file("SIGNATURE", `${fixture.signerId}\n${fixture.signatureB64}\n`);
    zip.file("assets/model.bin", "swapped payload");
    const result = await verifyArchiveSignature(zip, null, fixtureKeyResolver);
    expect(result.state).toBe("invalid");
  });
});

describe("verifyArchiveSignature · a declared signer with no signature is refused", () => {
  it("reports invalid when the manifest names a signer and no SIGNATURE entry exists", async () => {
    const zip = await buildArchive({ manifest: MANIFEST_WITH_SIGNER });
    const result = await verifyArchiveSignature(zip, "altnautica-2026-A");
    expect(result.state).toBe("invalid");
    expect(result.reason).toContain("no SIGNATURE entry");
    expect(result.verifiedSignerId).toBeUndefined();
  });

  it("reports invalid when the manifest claim disagrees with the signed id", async () => {
    const zip = await buildArchive({
      manifest: MANIFEST_WITH_SIGNER,
      signature: `some-other-key\n${fixture.signatureB64}\n`,
    });
    const result = await verifyArchiveSignature(zip, "altnautica-2026-A");
    expect(result.state).toBe("invalid");
    expect(result.reason).toContain("signed by");
  });

  it("reports invalid for a signer with no enrolled public key", async () => {
    const zip = await buildArchive({
      manifest: MANIFEST_NO_SIGNER,
      signature: `attacker-2026-A\n${fixture.signatureB64}\n`,
    });
    const result = await verifyArchiveSignature(zip);
    expect(result.state).toBe("invalid");
    expect(result.reason).toContain("not an enrolled");
  });

  it("reports invalid for a malformed SIGNATURE entry", async () => {
    const zip = await buildArchive({
      manifest: MANIFEST_NO_SIGNER,
      signature: "altnautica-2026-A\n",
    });
    expect((await verifyArchiveSignature(zip)).state).toBe("invalid");
  });

  it("reports invalid for a signature of the wrong length", async () => {
    const zip = await buildArchive({
      manifest: MANIFEST_NO_SIGNER,
      signature: "altnautica-2026-A\nZGVhZGJlZWY=\n",
    });
    const result = await verifyArchiveSignature(zip);
    expect(result.state).toBe("invalid");
    expect(result.reason).toContain("64");
  });

  it("reports unsigned only when nothing claims a signature", async () => {
    const zip = await buildArchive({ manifest: MANIFEST_NO_SIGNER });
    expect(await verifyArchiveSignature(zip)).toEqual({ state: "unsigned" });
  });

  it("cannot be satisfied by the shipped first-party signer id alone", async () => {
    // The whole attack this module closes: self-declare the first-party id and
    // ship no signature. The production resolver finds an enrolled key for the
    // id, and the archive still fails.
    expect(await importEnrolledSignerKey("altnautica-2026-A")).not.toBeNull();
    const zip = await buildArchive({
      manifest: MANIFEST_WITH_SIGNER,
      signature: `altnautica-2026-A\n${fixture.signatureB64}\n`,
    });
    const result = await verifyArchiveSignature(zip, "altnautica-2026-A");
    expect(result.state).toBe("invalid");
    expect(result.verifiedSignerId).toBeUndefined();
  });
});

describe("trust signals follow the verification result", () => {
  it("emits no signature badge for a declared-but-unverified first-party signer", () => {
    for (const signatureState of ["invalid", "unsigned", "unverified"] as const) {
      expect(
        displayTrustSignals({
          signatureState,
          signerId: "altnautica-2026-A",
        }),
      ).toEqual([]);
    }
  });

  it("emits signed + first-party only for a verified enrolled first-party signer", () => {
    expect(
      displayTrustSignals({
        signatureState: "verified",
        signerId: "altnautica-2026-A",
      }),
    ).toEqual(["signed", "first-party"]);
    expect(
      deriveTrustSignals({
        signatureState: "verified",
        signerId: "altnautica-2026-A",
      }),
    ).toEqual(["signed", "verified-publisher", "first-party"]);
  });

  it("emits signed only for a verified signer that is not first-party", () => {
    expect(
      displayTrustSignals({
        signatureState: "verified",
        signerId: "community-2026-A",
      }),
    ).toEqual(["signed"]);
  });

  it("does not grant first-party to an unenrolled id of the right shape", () => {
    expect(
      displayTrustSignals({
        signatureState: "verified",
        signerId: "altnautica-2099-Z",
      }),
    ).toEqual(["signed"]);
  });

  it("keeps license and vendor signals independent of the signature", () => {
    expect(
      displayTrustSignals({
        signatureState: "unverified",
        license: "GPL-3.0-or-later",
        vendorAttribution: [{ name: "rknn_toolkit" }],
      }),
    ).toEqual(["open-source", "vendor-binary"]);
  });
});
