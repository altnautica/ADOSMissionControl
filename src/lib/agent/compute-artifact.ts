/**
 * @module ComputeArtifact
 * @description Rewrite a compute-node reconstruction artifact URL to reach the
 * node through Mission Control's same-origin artifact proxy.
 *
 * The engine stamps each artifact's `uri`/`result_ref` with a host derived from
 * its own OS hostname (an mDNS `.local` name that the browser cannot resolve,
 * and that drifts between runs). The stored PATH under `/artifacts/` is stable,
 * so we keep the path and route it through `/api/lan-pair/artifact` at the host
 * the operator actually paired with — the Next server resolves `.local`→IPv4
 * server-side and streams the blob back over the same origin (no mixed-content,
 * no `.local` resolution in the browser). Rule 39 local-first.
 *
 * @license GPL-3.0-only
 */

/** Pull the stable `artifacts/<relpath>` segment out of a stored artifact URL,
 * ignoring the engine's (drifting, unresolvable) host. */
export function artifactRelPath(rawUri: string): string | null {
  const fromPath = (p: string): string | null => {
    const i = p.indexOf("artifacts/");
    return i >= 0 ? p.slice(i) : null;
  };
  try {
    const u = new URL(rawUri);
    return fromPath(u.pathname.replace(/^\/+/, ""));
  } catch {
    // Not an absolute URL — treat the input as a bare path.
    return fromPath(rawUri.replace(/^\/+/, ""));
  }
}

/**
 * Hand the artifact proxy this node's API key OUT OF BAND, as an `HttpOnly`
 * grant cookie scoped to `/api/lan-pair/artifact`.
 *
 * A third-party splat loader fetches the artifact URL itself, so the key
 * cannot travel as a request header on every consumer — but it must not
 * travel in the URL either: that key is full command authority over the
 * aircraft, and a query string lands in browser history, in the Next
 * server's and every fronting proxy's access log, and in a DOM attribute.
 *
 * Resolves either way; a failed mint only means the proxy answers 401/403
 * on a node that requires a key, which the viewers already surface.
 */
export async function grantArtifactAccess(
  pairedHost: string | null | undefined,
  apiKey: string | null | undefined,
): Promise<void> {
  const host = (pairedHost ?? "").trim();
  if (!host) return;
  try {
    await fetch("/api/lan-pair/artifact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host, key: apiKey ?? "" }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Non-fatal: see above.
  }
}

/** Rewrite a raw engine artifact URL to the same-origin proxy at the paired
 * host. Returns the raw URL unchanged when no paired host is known (nothing to
 * resolve against) or the URL carries no `artifacts/` path.
 *
 * Carries NO credential. Call `grantArtifactAccess` first for a node whose
 * agent requires a key. */
export function proxiedArtifactUrl(
  rawUri: string,
  pairedHost: string | null | undefined,
): string {
  const host = (pairedHost ?? "").trim();
  const rel = artifactRelPath(rawUri);
  if (!host || !rel) return rawUri;
  return `/api/lan-pair/artifact?${new URLSearchParams({ host, path: rel }).toString()}`;
}
