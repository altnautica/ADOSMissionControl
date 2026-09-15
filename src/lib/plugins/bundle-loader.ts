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

import { ensurePluginFrameCsp } from "./iframe-csp";

export async function loadPluginBundle(
  signedUrl: string,
): Promise<{ blobUrl: string; revoke: () => void }> {
  const res = await fetch(signedUrl);
  if (!res.ok) {
    throw new Error(
      `failed to load plugin bundle (${res.status} ${res.statusText})`,
    );
  }
  const html = ensurePluginFrameCsp(await res.text());
  const blobUrl = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  return {
    blobUrl,
    revoke: () => URL.revokeObjectURL(blobUrl),
  };
}
