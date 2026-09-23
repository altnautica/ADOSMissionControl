"use client";

/**
 * @module plugin-contribution-cache
 * @description The bundle blobs and handler surfaces every plugin slot host
 * shares. Several hosts mount at once (the shell-wide notification host, the
 * settings, hardware, planner and map slots, each drone's node detail), and
 * each runs the contribution producer. Without a shared cache every one of
 * them downloaded, unzipped and wrapped the same bundle and built its own
 * handler surface. Here a bundle is loaded once per `(installId, version)` and
 * a handler surface built once per `(pluginId, deviceId)`; each host holds a
 * reference, and the blob is revoked or the surface disposed when the last
 * holder lets go.
 *
 * @license GPL-3.0-only
 */

import { loadPluginBundle } from "@/lib/plugins/bundle-loader";
import { PluginAgentClient } from "@/lib/agent/plugin-client";
import {
  fetchRegistryArchive,
  openPinnedArchive,
  type ArchivePin,
} from "@/lib/plugins/archive-pin";
import { buildIframeHtml } from "@/components/plugins/transports/finalize-gcs-install";
import type { BridgeHandler } from "@/lib/plugins/bridge";

/** Where an install's GCS iframe bundle comes from. Cloud installs hand back a
 * short-lived signed Convex URL; local-first drone installs are served by the
 * LAN agent that unpacked the archive; local-first fleet / GCS-only installs
 * come from the published archive via the same-origin proxy. */
export type BundleSource =
  | { kind: "url"; url: string }
  | {
      kind: "agent";
      agentUrl: string;
      apiKey: string;
      pluginId: string;
      entrypoint: string;
    }
  | { kind: "archive"; archiveUrl: string; entrypoint: string; pin: ArchivePin };

interface LoadedBundle {
  blobUrl: string;
  revoke: () => void;
}

function wrapAsBlob(bundleJs: string): LoadedBundle {
  const blob = new Blob([buildIframeHtml(bundleJs)], { type: "text/html" });
  const blobUrl = URL.createObjectURL(blob);
  return { blobUrl, revoke: () => URL.revokeObjectURL(blobUrl) };
}

/**
 * Load an install's GCS bundle into a null-origin blob URL. The agent serves
 * the raw ESM module and the archive carries it; the sandboxed iframe needs an
 * HTML document, so both are wrapped in the same shell the cloud upload path
 * uses. An archive must match the hash and signer pinned at install before
 * anything in it runs: a release asset replaced after install would otherwise
 * run under the grants the operator gave the original.
 */
async function loadBundle(src: BundleSource, signal: AbortSignal): Promise<LoadedBundle> {
  if (src.kind === "url") return loadPluginBundle(src.url, signal);
  if (src.kind === "agent") {
    const client = new PluginAgentClient(src.agentUrl, src.apiKey);
    return wrapAsBlob(await client.getGcsBundle(src.pluginId, src.entrypoint));
  }
  const bytes = await fetchRegistryArchive(src.archiveUrl, (input, init) =>
    fetch(input, { ...init, signal }),
  );
  const zip = await openPinnedArchive(bytes, src.pin);
  const rel = src.entrypoint.replace(/^\.\//, "");
  const entry = zip.file(rel) ?? zip.file(`./${rel}`);
  if (!entry) throw new Error(`archive is missing ${rel}`);
  return wrapAsBlob(await entry.async("string"));
}

interface BundleEntry {
  refs: number;
  loaded: LoadedBundle | null;
  promise: Promise<string>;
  abort: AbortController;
}

const bundles = new Map<string, BundleEntry>();

/** Cache key for one install's bundle at one version. */
export function bundleKey(installId: string, version: string): string {
  return `${installId}@${version}`;
}

/**
 * Hold a reference to a bundle, loading it on first acquire. Resolves with the
 * blob URL; rejects when the load fails, in which case the entry is dropped so
 * the next acquire retries.
 */
export function acquireBundle(key: string, source: BundleSource): Promise<string> {
  const existing = bundles.get(key);
  if (existing) {
    existing.refs += 1;
    return existing.promise;
  }
  const abort = new AbortController();
  const entry: BundleEntry = { refs: 1, loaded: null, promise: Promise.resolve(""), abort };
  entry.promise = loadBundle(source, abort.signal).then(
    (loaded) => {
      // Every holder let go while it loaded: nothing will ever revoke it.
      if (bundles.get(key) !== entry) {
        loaded.revoke();
        throw new Error("bundle released before it loaded");
      }
      entry.loaded = loaded;
      return loaded.blobUrl;
    },
    (err: unknown) => {
      if (bundles.get(key) === entry) bundles.delete(key);
      throw err;
    },
  );
  bundles.set(key, entry);
  return entry.promise;
}

/** The loaded blob URL for a held bundle, or null while it loads. */
export function peekBundle(key: string): string | null {
  return bundles.get(key)?.loaded?.blobUrl ?? null;
}

/** Drop one reference; the last one revokes the blob or aborts the load. */
export function releaseBundle(key: string): void {
  const entry = bundles.get(key);
  if (!entry) return;
  entry.refs -= 1;
  if (entry.refs > 0) return;
  bundles.delete(key);
  if (entry.loaded) entry.loaded.revoke();
  else entry.abort.abort();
}

interface HandlerEntry {
  refs: number;
  handlers: Record<string, BridgeHandler>;
  dispose: () => void;
}

const handlerSurfaces = new Map<string, HandlerEntry>();

/** Cache key for one plugin's handler surface on one drone (or the fleet). */
export function handlerKey(pluginId: string, deviceId: string | null): string {
  return `${pluginId}|${deviceId ?? "*"}`;
}

/** Hold a reference to a plugin's handler surface, building it on first use. */
export function acquireHandlers(
  key: string,
  build: () => { handlers: Record<string, BridgeHandler>; dispose: () => void },
): Record<string, BridgeHandler> {
  const existing = handlerSurfaces.get(key);
  if (existing) {
    existing.refs += 1;
    return existing.handlers;
  }
  const built = build();
  handlerSurfaces.set(key, { refs: 1, handlers: built.handlers, dispose: built.dispose });
  return built.handlers;
}

/** Drop one reference; the last one disposes the surface. */
export function releaseHandlers(key: string): void {
  const entry = handlerSurfaces.get(key);
  if (!entry) return;
  entry.refs -= 1;
  if (entry.refs > 0) return;
  handlerSurfaces.delete(key);
  entry.dispose();
}
