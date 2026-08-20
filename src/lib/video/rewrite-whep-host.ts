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

/** mediamtx serves WHEP on this port across every ADOS deployment. Kept as a
 * literal (not a shared const) to match the other call sites
 * (`status-mapper/urls.ts`, `CloudStatusBridge.tsx`, `use-command-agent-fleet.ts`). */
const MEDIAMTX_WHEP_PORT = 8889;

/** Video states that mean the pipeline is definitively NOT serving, so no WHEP
 * URL should be offered to the cascade. Everything else (running,
 * not_initialized, connecting, starting) may be serving or transiently
 * coming up. */
const HARD_OFF_VIDEO_STATES = new Set([
  "stopped",
  "disabled",
  "error",
  "absent",
]);

/**
 * Resolve the WHEP URL the LAN-direct video cascade should dial for a
 * locally-connected agent.
 *
 * - When the agent's status carries a `whep_url`, re-point it at the host we
 *   are already polling successfully (`rewriteWhepHost`) so a mDNS/Host-header
 *   name the browser can't reach is swapped for the proven-reachable host.
 * - When the agent OMITS `whep_url` (the drone-profile `not_initialized`
 *   default, or a transient mediamtx-readiness miss while the endpoint is in
 *   fact serving), SYNTHESIZE `http://<reachable-host>:8889/main/whep` from the
 *   connected base URL instead of returning `null`. mediamtx's WHEP port + path
 *   are deployment-invariant and `agentBaseUrl` is reachable by definition (we
 *   poll it), so the cascade gets a URL to try rather than failing instantly
 *   with an empty cascade ("All transports failed"). Mirrors the cloud path's
 *   `resolveVideoUrls`. Hard-off states get no URL.
 */
export function resolveAgentWhepUrl(
  whepUrl: unknown,
  state: string | undefined,
  agentBaseUrl: string | null | undefined,
): string | null {
  if (typeof whepUrl === "string" && whepUrl) {
    return rewriteWhepHost(whepUrl, agentBaseUrl);
  }
  if (agentBaseUrl && state && !HARD_OFF_VIDEO_STATES.has(state)) {
    try {
      const base = new URL(agentBaseUrl);
      if (base.hostname) {
        return `http://${base.hostname}:${MEDIAMTX_WHEP_PORT}/main/whep`;
      }
    } catch {
      /* unparseable base URL; fall through to null */
    }
  }
  return null;
}
