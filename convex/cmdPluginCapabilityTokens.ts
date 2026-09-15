/**
 * @module cmdPluginCapabilityTokens
 * @description Cloud-issuer for short-lived capability tokens that
 * authorise plugin RPC calls from the GCS half to the agent half.
 *
 * Each token carries:
 *   - `pluginId`     plugin install identity (reverse-DNS)
 *   - `agentId`      target drone device id
 *   - `operatorId`   issuing user
 *   - `expiresAt`    epoch ms, hard-bounded by `TOKEN_TTL_MS`
 *   - `grantedCapabilities`  string[] of permission ids
 *   - `iss`          issuer hint, `cloud:<userId>`
 *
 * Wire format:
 *
 *     urlsafe_b64(canonical_json_blob) + "." + urlsafe_b64(hmac_sha256_sig)
 *
 * Canonical JSON = sorted top-level keys, no whitespace. The signer
 * here MUST produce byte-for-byte the same blob the verifier in
 * `src/lib/plugins/capability-token-claims.ts` (and the agent's
 * `_canonical_claims_blob`) reads back, because both sides verify
 * against the exact bytes received off the wire.
 *
 * The signer mirrors `src/lib/plugins/canonical-token.ts`. The two
 * implementations cannot share a module today because Convex actions
 * run in a Convex-managed runtime that does not resolve the `@/` path
 * alias; mirror manually if you change one.
 *
 * Crypto: Web Crypto (`crypto.subtle`), no "use node" needed.
 *
 * Signing key: NOT the operator's root HMAC secret. Every token is
 * signed with a key derived from that secret and the (install, device)
 * pair being minted for (`lib/capabilityTokenKeys`), which is the same
 * key `operatorHmacSecrets.getMyVerificationKey` hands the GCS bridge
 * for that one iframe. The root secret stays on the backend.
 *
 * @license GPL-3.0-only
 */

import { v } from "convex/values";
import { action } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { api, internal } from "./_generated/api";
import { deriveCapabilityTokenKey } from "./lib/capabilityTokenKeys";
import type { Doc } from "./_generated/dataModel";

/** Tokens expire 10 minutes after mint. */
const TOKEN_TTL_MS = 10 * 60 * 1000;

interface TokenClaims {
  pluginId: string;
  agentId: string;
  operatorId: string;
  expiresAt: number;
  grantedCapabilities: string[];
  iss: string;
}

interface MintResult {
  token: string;
  expiresAt: number;
}

// ──────────────────────────────────────────────────────────────
// Helpers (Web Crypto + canonical JSON)
// ──────────────────────────────────────────────────────────────

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function urlsafeB64NoPad(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Sorted top-level keys, no whitespace. Matches the agent's
 * `_canonical_claims_blob`. Keep in sync with
 * `src/lib/plugins/canonical-token.ts`. */
function canonicalClaimsBytes(claims: TokenClaims): Uint8Array {
  const sortedKeys: (keyof TokenClaims)[] = [
    "agentId",
    "expiresAt",
    "grantedCapabilities",
    "iss",
    "operatorId",
    "pluginId",
  ];
  const obj: Record<string, unknown> = {};
  for (const k of sortedKeys) obj[k] = claims[k];
  return new TextEncoder().encode(JSON.stringify(obj));
}

async function signTokenCanonical(
  claims: TokenClaims,
  secretBase64: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    base64ToBytes(secretBase64) as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const blob = canonicalClaimsBytes(claims);
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, blob as BufferSource),
  );
  return `${urlsafeB64NoPad(blob)}.${urlsafeB64NoPad(sig)}`;
}

// ──────────────────────────────────────────────────────────────
// Action
// ──────────────────────────────────────────────────────────────

/**
 * Mint a capability token for `pluginInstallId` running on
 * `deviceId`. The action proves the caller owns the install and
 * that the install actually targets the device, then materialises
 * the granted capability set from `cmd_pluginPermissions`.
 */
export const mintToken = action({
  args: {
    pluginInstallId: v.id("cmd_pluginInstalls"),
    deviceId: v.string(),
  },
  handler: async (ctx, args): Promise<MintResult> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const install: Doc<"cmd_pluginInstalls"> | null = await ctx.runQuery(
      api.cmdPlugins.getInstall,
      { id: args.pluginInstallId },
    );
    if (!install || install.userId !== userId) {
      throw new Error("Plugin install not found");
    }
    // Per-drone scope: the install row must be bound to the same
    // device the caller wants a token for. GCS-only installs
    // (droneId undefined) cannot mint agent-bound tokens.
    if (install.droneId !== args.deviceId) {
      throw new Error("Plugin install does not target this drone");
    }

    const permissions: Doc<"cmd_pluginPermissions">[] = await ctx.runQuery(
      api.cmdPlugins.listPermissionsForInstall,
      { installId: args.pluginInstallId },
    );
    const grantedCapabilities = permissions
      .filter((p) => p.granted)
      .map((p) => p.permissionId);

    const expiresAt = Date.now() + TOKEN_TTL_MS;
    const claims: TokenClaims = {
      pluginId: install.pluginId,
      agentId: args.deviceId,
      operatorId: userId,
      expiresAt,
      grantedCapabilities,
      iss: `cloud:${userId}`,
    };

    // Sign with the per-(install, device) derived key, not the root
    // secret: the browser that verifies this token only ever holds the
    // derived one, so the two must agree on the derivation.
    const rootSecretBase64: string = await ctx.runAction(
      internal.operatorHmacSecrets.getOrCreateCurrent,
      { userId },
    );
    const signingKeyBase64 = await deriveCapabilityTokenKey(
      rootSecretBase64,
      args.pluginInstallId,
      args.deviceId,
    );
    const token = await signTokenCanonical(claims, signingKeyBase64);
    return { token, expiresAt };
  },
});
