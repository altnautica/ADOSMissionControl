/**
 * @module rewrite-whep-host
 * @description Rewrite a WHEP URL's hostname to the host the GCS is actually
 * reaching the agent on.
 *
 * The agent builds its `whep_url` from the HTTP request Host header, so the
 * host baked into it is whatever name the GCS happened to dial — often an
 * mDNS `.local` name. The browser's WebRTC/fetch layer cannot always resolve
 * a `.local` name (OS-level mDNS works for plain `curl`, but the in-page
 * WebRTC signaling fetch can fail or resolve to a stale IP after the agent
 * changes networks). The result is a WHEP POST that never connects while the
 * direct IP link plays fine.
 *
 * The GCS is, by definition, already polling the agent successfully on its
 * connected base URL, so that host IS reachable from the browser. Pointing
 * the WHEP signaling at the same host (keeping the agent's WHEP port + path)
 * makes the LAN-direct transport use a proven-reachable address. The WebRTC
 * media/ICE candidates are gathered independently by mediamtx from the
 * drone's physical interfaces, so only the signaling host needs aligning.
 *
 * This mirrors what the cloud path already does via `resolveVideoUrls`
 * (status-mapper.ts) for the HTTPS/relay case; this is the local/HTTP twin.
 *
 * @license GPL-3.0-only
 */

/**
 * Return `whepUrl` with its hostname replaced by the hostname of
 * `agentBaseUrl`, preserving the WHEP URL's protocol, port, and path.
 *
 * Defensive: if either input is empty or unparseable, the original
 * `whepUrl` is returned unchanged so a malformed value never breaks the
 * video cascade.
 */
export function rewriteWhepHost(
  whepUrl: string | null | undefined,
  agentBaseUrl: string | null | undefined,
): string | null {
  if (!whepUrl) return whepUrl ?? null;
  if (!agentBaseUrl) return whepUrl;
  // Current agents advertise a RELATIVE, same-origin media path (/whep) served
  // by the agent's own :8080 front — the same origin the GCS polls `/api/*`
  // against. Resolve it against that base instead of host-swapping (a relative
  // URL has no host to swap). Kept raw when the base is unparseable.
  if (whepUrl.startsWith("/")) {
    try {
      return `${new URL(agentBaseUrl).origin}${whepUrl}`;
    } catch {
      return whepUrl;
    }
  }
  try {
    const whep = new URL(whepUrl);
    const base = new URL(agentBaseUrl);
    if (!base.hostname || base.hostname === whep.hostname) return whepUrl;
    whep.hostname = base.hostname;
    return whep.toString();
  } catch {
    return whepUrl;
  }
}

/**
 * Resolve the WHEP URL the LAN-direct video cascade should dial for a
 * locally-connected agent: the URL the agent advertised, re-pointed at the host
 * we are already polling successfully (`rewriteWhepHost`), so a mDNS/Host-header
 * name the browser can't reach is swapped for the proven-reachable host.
 *
 * An agent that advertises no `whep_url` is not streaming, and nothing is
 * synthesized in its place: mediamtx's own WHEP port is loopback-only on the
 * node, and the node's :8080 front is the only authenticated media origin.
 */
export function resolveAgentWhepUrl(
  whepUrl: unknown,
  agentBaseUrl: string | null | undefined,
): string | null {
  return typeof whepUrl === "string" && whepUrl
    ? rewriteWhepHost(whepUrl, agentBaseUrl)
    : null;
}
