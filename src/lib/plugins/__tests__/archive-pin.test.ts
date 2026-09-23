/**
 * @license GPL-3.0-only
 *
 * A plugin archive fetched by URL at every mount must be the archive the
 * operator installed: same bytes, still signed by the same enrolled signer.
 */

import { describe, it, expect } from "vitest";
import JSZip from "jszip";

import { openPinnedArchive, pinArchive } from "../archive-pin";
import type { SignerKeyResolver } from "../archive-signature";
import fixture from "./fixtures/signed-archive.json";

function bytesFromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

const fixtureKey: SignerKeyResolver = async (signerId) => {
  if (signerId !== fixture.signerId) return null;
  const der = bytesFromBase64(fixture.signerSpkiBase64);
  const buf = new ArrayBuffer(der.byteLength);
  new Uint8Array(buf).set(der);
  return crypto.subtle.importKey("spki", buf, { name: "Ed25519" }, false, ["verify"]);
};

async function signedArchive(): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(bytesFromBase64(fixture.archiveB64));
  zip.file("SIGNATURE", `${fixture.signerId}\n${fixture.signatureB64}\n`);
  return zip.generateAsync({ type: "uint8array" });
}

async function unsignedArchive(bundle: string): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("manifest.yaml", "id: com.example.plain\nversion: 1.0.0\n");
  zip.file("gcs/plugin.bundle.js", bundle);
  return zip.generateAsync({ type: "uint8array" });
}

describe("archive pin", () => {
  it("pins a signed archive to its hash and verified signer, and reopens it", async () => {
    const bytes = await signedArchive();
    const pin = await pinArchive(bytes, { resolveKey: fixtureKey });
    expect(pin.signerId).toBe(fixture.signerId);
    expect(pin.sha256).toMatch(/^[0-9a-f]{64}$/);
    await expect(openPinnedArchive(bytes, pin, fixtureKey)).resolves.toBeInstanceOf(JSZip);
  });

  it("refuses an archive replaced after install", async () => {
    const pin = await pinArchive(await unsignedArchive("export default 1;"));
    const replaced = await unsignedArchive("export default 2;");
    await expect(openPinnedArchive(replaced, pin)).rejects.toThrow(/changed since it was installed/);
  });

  it("refuses a pinned archive whose signer is no longer enrolled", async () => {
    const bytes = await signedArchive();
    const pin = await pinArchive(bytes, { resolveKey: fixtureKey });
    await expect(openPinnedArchive(bytes, pin, async () => null)).rejects.toThrow(/signature/);
  });

  it("refuses at install when the bytes do not match the published hash", async () => {
    const bytes = await unsignedArchive("export default 1;");
    await expect(pinArchive(bytes, { expectedSha256: "00".repeat(32) })).rejects.toThrow(/hash/);
  });
});
