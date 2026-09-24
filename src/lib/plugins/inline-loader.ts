"use client";

/**
 * @module plugins/inline-loader
 * @description Loads a trusted inline GCS module: fetches its bytes with the
 * evidence that vouches for them, runs the trust gate (`./inline-trust`), and
 * only then imports it from a `blob:` URL. A module that fails the gate is
 * never imported; the caller shows the error and never falls back to an
 * iframe.
 *
 * Inline modules share the host's React. Before the first import the host
 * publishes a frozen `globalThis.__ADOS_INLINE_SHARED__`, which the SDK's
 * `inlineSharedExternals()` build plugin rewrites `react`, `react-dom`,
 * `react-dom/client` and `react/jsx-runtime` imports to read.
 *
 * @license GPL-3.0-only
 */

import * as React from "react";
import * as ReactDom from "react-dom";
import * as ReactDomClient from "react-dom/client";
import * as JsxRuntime from "react/jsx-runtime";

import { fetchRegistryArchive, sha256Hex, type ArchivePin } from "./archive-pin";
import { InlineHostError, type InlinePluginModule } from "./inline-host-types";
import {
  InlineTrustError,
  verifyInlineArchive,
  verifyInlineModule,
  type InlineTrust,
} from "./inline-trust";
import { pluginClientForReach, resolveNodeAgentReach } from "./node-agent-reach";
import { parseManifestYaml } from "@/components/plugins/transports/manifest-parse";

/** A verified, imported inline module and the source its assets come from. */
export interface InlineBundle {
  kind: "inline";
  module: InlinePluginModule;
  trust: InlineTrust;
  /** A file under the plugin's `gcs/` dir (`path` relative to it), read from
   * the same source the module came from. */
  readAsset: (path: string) => Promise<Blob>;
}

const SHARED_GLOBAL = "__ADOS_INLINE_SHARED__";

/** Publish the host's React to inline modules, once, immutably. */
function installInlineShared(): void {
  if (Object.hasOwn(globalThis, SHARED_GLOBAL)) return;
  Object.defineProperty(globalThis, SHARED_GLOBAL, {
    value: Object.freeze({
      react: Object.freeze({ ...React }),
      reactDom: Object.freeze({ ...ReactDom }),
      reactDomClient: Object.freeze({ ...ReactDomClient }),
      jsxRuntime: Object.freeze({ ...JsxRuntime }),
    }),
    writable: false,
    configurable: false,
    enumerable: false,
  });
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return buf;
}

function isInlineModule(value: unknown): value is InlinePluginModule {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { mount?: unknown }).mount === "function"
  );
}

/** Import verified module bytes. The module's default export or its named
 * `plugin` export is the `InlinePluginModule`. */
async function importInlineModule(bytes: Uint8Array): Promise<InlinePluginModule> {
  installInlineShared();
  const url = URL.createObjectURL(new Blob([toArrayBuffer(bytes)], { type: "text/javascript" }));
  try {
    // Runtime-selected: the specifier is the verified module's blob URL.
    const ns = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url)) as {
      default?: unknown;
      plugin?: unknown;
    };
    const mod = isInlineModule(ns.default) ? ns.default : ns.plugin;
    if (!isInlineModule(mod)) {
      throw new InlineTrustError(
        "module_mismatch",
        "the module exports no inline plugin (default or `plugin` with mount())",
      );
    }
    return mod;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** The archive path of a GCS entrypoint, which must live under `gcs/`. */
function gcsRelative(entrypoint: string): string {
  const path = entrypoint.replace(/^\.\//, "");
  if (!path.startsWith("gcs/")) {
    throw new InlineTrustError("manifest_mismatch", `entrypoint ${path} is not under gcs/`);
  }
  return path.slice("gcs/".length);
}

/**
 * Load an inline module from the node agent that runs the plugin, over the
 * node's LAN address or its ground station's relay (through the same-origin
 * proxy on an HTTPS page). The entrypoint is read from the manifest the
 * attestation signs, and signed assets are checked against their attested
 * digests as they are read.
 */
export async function loadInlineFromNode(
  src: { deviceId: string; pluginId: string },
  signal: AbortSignal,
): Promise<InlineBundle> {
  const reach = resolveNodeAgentReach(src.deviceId);
  if (!reach) {
    throw new InlineHostError("no_node_agent", "Connect to this node to load this extension");
  }
  const client = pluginClientForReach(reach);
  const { pluginId } = src;
  const [attestation, manifestBytes] = await Promise.all([
    client.getAttestation(pluginId, { signal }),
    client.getManifestBytes(pluginId, { signal }),
  ]);
  // Only a locator: `verifyInlineModule` checks this manifest against its
  // signed digest and that it declares this entrypoint.
  const entrypoint = parseManifestYaml(new TextDecoder().decode(manifestBytes)).gcsEntrypoint;
  if (!entrypoint) {
    throw new InlineTrustError("manifest_mismatch", "the manifest declares no GCS entrypoint");
  }
  const moduleBytes = new Uint8Array(
    await client.getGcsAsset(pluginId, gcsRelative(entrypoint), { signal }),
  );
  const trust = await verifyInlineModule({
    pluginId,
    entrypoint,
    moduleBytes,
    manifestBytes,
    attestation,
  });
  const signedDigest = new Map(
    attestation.files.filter((f) => f.payload !== true).map((f) => [f.path, f.sha256]),
  );
  return {
    kind: "inline",
    module: await importInlineModule(moduleBytes),
    trust,
    readAsset: async (path) => {
      const bytes = new Uint8Array(await client.getGcsAsset(pluginId, path));
      const expected = signedDigest.get(`gcs/${path}`);
      if (expected !== undefined && expected !== (await sha256Hex(bytes))) {
        throw new InlineHostError("asset_unavailable", `gcs/${path} does not match its signed digest`);
      }
      return new Blob([toArrayBuffer(bytes)]);
    },
  };
}

/** Load an inline module from a pinned published archive (a GCS-level
 * install with no node); assets come from the same verified archive. */
export async function loadInlineFromArchive(
  src: { archiveUrl: string; pin: ArchivePin; pluginId: string; entrypoint: string },
  signal: AbortSignal,
): Promise<InlineBundle> {
  const archiveBytes = await fetchRegistryArchive(src.archiveUrl, (input, init) =>
    fetch(input, { ...init, signal }),
  );
  const { moduleBytes, trust, zip } = await verifyInlineArchive({
    pluginId: src.pluginId,
    entrypoint: src.entrypoint,
    archiveBytes,
    pin: src.pin,
  });
  return {
    kind: "inline",
    module: await importInlineModule(moduleBytes),
    trust,
    readAsset: async (path) => {
      const entry = zip.file(`gcs/${path}`);
      if (!entry) throw new InlineHostError("asset_unavailable", `the archive has no gcs/${path}`);
      return new Blob([await entry.async("arraybuffer")]);
    },
  };
}
