/**
 * @license GPL-3.0-only
 */
import { describe, it, expect, vi } from "vitest";
import JSZip from "jszip";

import {
  finalizeGcsInstall,
  buildIframeHtml,
  type FinalizeGcsInstallInputs,
} from "../finalize-gcs-install";

const BUNDLE_JS = 'console.log("follow-me boot");export const x=1;';

async function makeArchive(withBundle: boolean): Promise<Blob> {
  const zip = new JSZip();
  zip.file("manifest.yaml", "id: com.altnautica.follow-me\nversion: 0.1.0\n");
  if (withBundle) zip.file("gcs/plugin.bundle.js", BUNDLE_JS);
  const bytes = await zip.generateAsync({ type: "arraybuffer" });
  return new Blob([bytes], { type: "application/zip" });
}

/** An archive whose manifest self-declares the first-party signer id and
 * carries no SIGNATURE entry to back it. */
async function makeClaimantArchive(): Promise<Blob> {
  const zip = new JSZip();
  zip.file(
    "manifest.yaml",
    "id: com.altnautica.follow-me\nversion: 0.1.0\nsigner_id: altnautica-2026-A\n",
  );
  zip.file("gcs/plugin.bundle.js", BUNDLE_JS);
  const bytes = await zip.generateAsync({ type: "arraybuffer" });
  return new Blob([bytes], { type: "application/zip" });
}

function gcsManifest(): FinalizeGcsInstallInputs["manifest"] {
  return {
    pluginId: "com.altnautica.follow-me",
    version: "0.1.0",
    name: "ADOS Follow-Me",
    halves: ["agent", "gcs"],
    signatureState: "verified",
    trustSignals: ["signed", "verified-publisher"],
    permissions: [
      { id: "command.send", required: true, half: "gcs" },
      { id: "vision.detection.subscribe", required: true, half: "agent" },
    ],
    contributesSlots: [
      { slot: "flight.skill", panelId: "follow-me" },
      { slot: "video.overlay", panelId: "follow-me-overlay" },
      { slot: "node.detail.tab", panelId: "follow-me-tab", title: "Follow-Me", order: 70 },
    ],
  };
}

/** Record-keeping stub callables + a fetch stub that resolves the
 * archive proxy and the storage upload. */
function makeHarness(opts: { archiveForUrl?: Blob } = {}) {
  const calls = {
    recordInstall: [] as unknown[],
    grant: [] as unknown[],
    status: [] as unknown[],
    uploadBodies: [] as string[],
  };
  const callables = {
    generateUploadUrl: vi.fn(async () => "https://storage.test/upload-1"),
    recordInstall: vi.fn(async (args: unknown) => {
      calls.recordInstall.push(args);
      return "install-1";
    }),
    grantPermission: vi.fn(async (args: unknown) => {
      calls.grant.push(args);
    }),
    setStatus: vi.fn(async (args: unknown) => {
      calls.status.push(args);
    }),
  };
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("/api/registry-archive")) {
      const bytes = new Uint8Array(await (opts.archiveForUrl as Blob).arrayBuffer());
      return new Response(bytes, { status: 200 });
    }
    if (url === "https://storage.test/upload-1") {
      calls.uploadBodies.push(String((init?.body as Blob) ? "blob" : ""));
      return new Response(JSON.stringify({ storageId: "stor-1" }), {
        status: 200,
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  return { calls, callables, fetchImpl };
}

describe("finalizeGcsInstall", () => {
  it("file install: extracts the bundle, uploads it, records the install enabled", async () => {
    const { callables, fetchImpl } = makeHarness();
    const archive = await makeArchive(true);
    const installId = await finalizeGcsInstall({
      archive,
      manifest: gcsManifest(),
      manifestHash: "hash-abc",
      grantedPermissions: ["command.send"],
      deviceId: "drone-9",
      source: "local_file",
      callables,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(installId).toBe("install-1");
    expect(callables.generateUploadUrl).toHaveBeenCalledOnce();
    const recArgs = callables.recordInstall.mock.calls[0][0] as Record<string, unknown>;
    expect(recArgs.bundleStorageId).toBe("stor-1");
    expect(recArgs.droneId).toBe("drone-9");
    expect(recArgs.source).toBe("local_file");
    // gcsContributes carries all three slot rows from the manifest.
    expect((recArgs.gcsContributes as unknown[]).length).toBe(3);
    // The granted (declared) permission is granted; the un-granted one is not.
    expect(callables.grantPermission).toHaveBeenCalledOnce();
    expect(callables.grantPermission.mock.calls[0][0]).toEqual({
      installId: "install-1",
      permissionId: "command.send",
    });
    expect(callables.setStatus).toHaveBeenCalledWith({
      installId: "install-1",
      status: "enabled",
    });
  });

  it("registry install: fetches the archive via the proxy, then finalizes", async () => {
    const archive = await makeArchive(true);
    const { callables, fetchImpl } = makeHarness({ archiveForUrl: archive });
    await finalizeGcsInstall({
      archiveUrl:
        "https://github.com/altnautica/ADOSExtensions/releases/download/follow-me-v0.1.0/x.signed.adosplug",
      manifest: gcsManifest(),
      manifestHash: "hash-abc",
      grantedPermissions: [],
      deviceId: "drone-9",
      source: "registry",
      sourceUri: "https://github.com/.../x.signed.adosplug",
      callables,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    // The proxy was hit (archive fetch) and the bundle uploaded.
    expect(
      fetchImpl.mock.calls.some(([u]) =>
        String(u).startsWith("/api/registry-archive"),
      ),
    ).toBe(true);
    const recArgs = callables.recordInstall.mock.calls[0][0] as Record<string, unknown>;
    expect(recArgs.bundleStorageId).toBe("stor-1");
    expect(recArgs.source).toBe("registry");
  });

  it("agent-only plugin: records the install without a bundle, no upload", async () => {
    const { callables, fetchImpl } = makeHarness();
    const manifest = gcsManifest();
    const agentOnly = { ...manifest, halves: ["agent"] as const, contributesSlots: [] };
    const archive = await makeArchive(false);
    await finalizeGcsInstall({
      archive,
      manifest: agentOnly,
      manifestHash: "hash-abc",
      grantedPermissions: ["vision.detection.subscribe"],
      deviceId: "drone-9",
      source: "local_file",
      callables,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(callables.generateUploadUrl).not.toHaveBeenCalled();
    const recArgs = callables.recordInstall.mock.calls[0][0] as Record<string, unknown>;
    expect(recArgs.bundleStorageId).toBeUndefined();
    expect(callables.setStatus).toHaveBeenCalledWith({
      installId: "install-1",
      status: "enabled",
    });
  });

  it("throws a stage-tagged error when the GCS bundle is missing", async () => {
    const { callables, fetchImpl } = makeHarness();
    const archive = await makeArchive(false); // no gcs/plugin.bundle.js
    await expect(
      finalizeGcsInstall({
        archive,
        manifest: gcsManifest(),
        manifestHash: "hash-abc",
        grantedPermissions: [],
        deviceId: null,
        source: "local_file",
        callables,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ stage: "extract-bundle" });
    expect(callables.recordInstall).not.toHaveBeenCalled();
  });

  it("refuses an archive whose manifest declares a signer it cannot back", async () => {
    // The install blocker: a third party self-declares the first-party signer
    // id and ships no SIGNATURE entry. Nothing may be extracted, uploaded or
    // recorded, and no install row may carry the claimed signer.
    const { callables, fetchImpl } = makeHarness();
    await expect(
      finalizeGcsInstall({
        archive: await makeClaimantArchive(),
        manifest: { ...gcsManifest(), signerId: "altnautica-2026-A" },
        manifestHash: "hash-abc",
        grantedPermissions: ["command.send"],
        deviceId: "drone-9",
        source: "local_file",
        callables,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ stage: "verify-signature" });
    expect(callables.generateUploadUrl).not.toHaveBeenCalled();
    expect(callables.recordInstall).not.toHaveBeenCalled();
    expect(callables.setStatus).not.toHaveBeenCalled();
  });

  it("records no signer id for an unsigned archive", async () => {
    // An unsigned archive still installs (developer builds) and the row carries
    // no signer, because `signerId` on the row now means "this signature
    // verified here" rather than "the manifest said so".
    const { callables, fetchImpl } = makeHarness();
    await finalizeGcsInstall({
      archive: await makeArchive(true),
      manifest: gcsManifest(),
      manifestHash: "hash-abc",
      grantedPermissions: [],
      deviceId: "drone-9",
      source: "local_file",
      callables,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const recArgs = callables.recordInstall.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(recArgs.signerId).toBeUndefined();
  });
});

describe("buildIframeHtml", () => {
  it("inlines the bundle as a module and escapes a closing script tag", () => {
    const html = buildIframeHtml('const s = "</script>";');
    expect(html).toContain('<script type="module">');
    expect(html).toContain("<!doctype html>");
    // The literal closing tag inside the bundle must be escaped so it
    // does not terminate the inline module early.
    expect(html).not.toContain('"</script>"');
    expect(html).toContain("<\\/script>");
  });

  it("declares the plugin frame policy so the frame cannot reach the network", () => {
    // A blob: frame inherits the app's CSP, and the app must allow bare
    // http:/ws: to reach LAN agents. Only the in-document policy pins the
    // frame to connect-src 'none'.
    const html = buildIframeHtml("export const x = 1;");
    expect(html).toContain('http-equiv="Content-Security-Policy"');
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain("default-src 'none'");
    expect(html).not.toContain("unsafe-eval");
    // The policy must precede the inline module, or the module runs unpoliced.
    expect(html.indexOf("Content-Security-Policy")).toBeLessThan(
      html.indexOf("<script"),
    );
  });
});
