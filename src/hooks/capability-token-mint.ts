/**
 * Mint helpers for `useCapabilityToken`. Split out so the hook file
 * stays under the 250 LOC target.
 *
 * The Convex action `cmdPluginCapabilityTokens.mintToken` returns
 * exactly `{ token: string; expiresAt: number }`. `mintCloud` asserts
 * that shape and fails loud on anything else, so a future `{ ok: true,
 * ... }` envelope would be rejected at the shape check rather than
 * silently misread.
 *
 * @license GPL-3.0-only
 */

import {
  parseTokenClaims,
  type TokenClaims,
} from "@/lib/plugins/capability-token-claims";
import type { Id } from "../../convex/_generated/dataModel";

export interface MintedToken {
  token: string;
  claims: TokenClaims;
  /** Wall-clock ms after which the cache entry is considered stale and
   * a fresh mint runs even on a cache lookup. */
  cacheUntilMs: number;
}

export type CloudMintResult = { token: string; expiresAt: number };

export type CloudMint = (args: {
  pluginInstallId: Id<"cmd_pluginInstalls">;
  deviceId: string;
}) => Promise<CloudMintResult>;

export const REFRESH_LEAD_MS = 60 * 1000;

export async function mintCloud(
  mint: CloudMint,
  pluginInstallId: string,
  deviceId: string,
): Promise<MintedToken> {
  const res = await mint({
    pluginInstallId: pluginInstallId as Id<"cmd_pluginInstalls">,
    deviceId,
  });
  if (!res || typeof res.token !== "string" || typeof res.expiresAt !== "number") {
    throw new Error("cloud mint returned an unexpected shape");
  }
  const claims = parseTokenClaims(res.token).claims;
  return wrapMinted(res.token, claims);
}

/**
 * Mint an agent-issued token. `pluginId` is the manifest (reverse-DNS) plugin
 * id: the agent's `POST /api/plugins/capability-token` looks the install up
 * by it (see `CapabilityTokenRequest` in the agent's plugin routes).
 */
export async function mintLan(
  lanUrl: string | null,
  lanKey: string | null,
  pluginId: string,
): Promise<MintedToken> {
  if (!lanUrl || !lanKey) {
    throw new Error("LAN mint requires a paired agent with a known host + key");
  }
  const res = await fetch(`${lanUrl}/api/plugins/capability-token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-ADOS-Key": lanKey,
    },
    body: JSON.stringify({ plugin_id: pluginId }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => `${res.status}`);
    throw new Error(`LAN mint failed: ${res.status} ${body}`);
  }
  const data = (await res.json()) as { token?: unknown };
  if (typeof data.token !== "string") {
    throw new Error("LAN mint did not return a token string");
  }
  const claims = parseTokenClaims(data.token).claims;
  return wrapMinted(data.token, claims);
}

function wrapMinted(token: string, claims: TokenClaims): MintedToken {
  return {
    token,
    claims,
    cacheUntilMs: Math.max(claims.expiresAt - REFRESH_LEAD_MS, Date.now()),
  };
}

// ----------------------------------------------------------------------
// Module-level dedupe cache (keyed by (transport, pluginInstallId, deviceId))
// ----------------------------------------------------------------------

const tokenCache = new Map<string, MintedToken>();
const inflightCache = new Map<string, Promise<MintedToken>>();

export function readCache(key: string): MintedToken | null {
  const entry = tokenCache.get(key);
  if (!entry) return null;
  if (entry.cacheUntilMs <= Date.now()) {
    tokenCache.delete(key);
    return null;
  }
  return entry;
}

export function writeCache(key: string, minted: MintedToken): void {
  tokenCache.set(key, minted);
}

export function readInflight(key: string): Promise<MintedToken> | null {
  return inflightCache.get(key) ?? null;
}

export function writeInflight(
  key: string,
  promise: Promise<MintedToken>,
): void {
  inflightCache.set(key, promise);
  promise
    .then((minted) => writeCache(key, minted))
    .catch(() => {
      /* swallow; surfaced via the awaited caller */
    })
    .finally(() => {
      if (inflightCache.get(key) === promise) {
        inflightCache.delete(key);
      }
    });
}

/** Test-only: reset the module-level caches. */
export function __resetCapabilityTokenCacheForTests(): void {
  tokenCache.clear();
  inflightCache.clear();
}
