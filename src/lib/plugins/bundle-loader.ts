/**
 * Loads a signed plugin bundle URL into a same-process blob URL so a
 * sandboxed iframe can host it with a null origin.
 *
 * A sandboxed `<iframe sandbox="allow-scripts">` must NOT also carry
 * `allow-same-origin`, so the document it loads has to come from a
 * null-origin source. A remote https URL would hand the iframe the
 * bundle host's origin; a `blob:` URL minted here is null-origin, which
 * is the trust boundary the plugin host relies on. This leaf fetches the
 * signed URL once and returns the blob URL plus a revoke handle the
 * caller invokes on unmount to release the object URL.
 *
 * The fetched document is normalised through `ensurePluginFrameCsp` before the
 * blob is minted. `buildIframeHtml` already embeds the policy for documents
 * built in this session, but this path re-fetches a shell that was uploaded to
 * Convex storage at install time — an install recorded before the policy
 * existed would otherwise mint a frame that only inherits the app's permissive
 * `connect-src`. Normalising here makes the blob-mint the single choke point
 * where every plugin frame acquires the policy, with no storage migration.
 *
 * @module plugins/bundle-loader
 * @license GPL-3.0-only
 */

import { withTimeoutSignal } from "@/lib/agent/agent-client/timeout";
import { ensurePluginFrameCsp } from "./iframe-csp";

/** Deadline for one bundle fetch, headers through the last body byte. */
export const PLUGIN_BUNDLE_FETCH_TIMEOUT_MS = 15_000;

/** Largest plugin shell document the host will wrap into a frame. */
export const PLUGIN_BUNDLE_MAX_BYTES = 16 * 1024 * 1024;

/**
 * Read a response body as text, refusing past `maxBytes`. The declared
 * length is checked first; the streamed byte count is authoritative because
 * a server can omit or understate `Content-Length`.
 */
async function readCappedText(res: Response, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`plugin bundle exceeds ${maxBytes} bytes`);
  }
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`plugin bundle exceeds ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/**
 * Fetch `signedUrl` into a null-origin blob URL. The fetch aborts when
 * `signal` fires (the caller unmounted or moved on) or after
 * {@link PLUGIN_BUNDLE_FETCH_TIMEOUT_MS}, and refuses a body larger than
 * {@link PLUGIN_BUNDLE_MAX_BYTES}, so one stalled or oversized URL cannot hold
 * the host.
 */
export async function loadPluginBundle(
  signedUrl: string,
  signal?: AbortSignal,
): Promise<{ blobUrl: string; revoke: () => void }> {
  const res = await fetch(signedUrl, {
    signal: withTimeoutSignal(PLUGIN_BUNDLE_FETCH_TIMEOUT_MS, signal ?? null),
  });
  if (!res.ok) {
    throw new Error(
      `failed to load plugin bundle (${res.status} ${res.statusText})`,
    );
  }
  const html = ensurePluginFrameCsp(
    await readCappedText(res, PLUGIN_BUNDLE_MAX_BYTES),
  );
  const blobUrl = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  return {
    blobUrl,
    revoke: () => URL.revokeObjectURL(blobUrl),
  };
}
