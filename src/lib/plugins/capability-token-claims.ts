/**
 * JSON-claim capability token verifier (multi-issuer).
 *
 * Carried on cross-process postMessage RPCs and signed by one of three
 * issuers:
 *
 *   * `iss: cloud:<userId>`   - operator HMAC secret (Convex
 *                                `operator_hmac_secrets`).
 *   * `iss: agent:<deviceId>` - per-pairing HMAC secret derived via
 *                                HKDF-SHA256 from the pairing key
 *                                (salt: `b"ados/plugin-capability-token/v1"`,
 *                                info empty). Agent mirror:
 *                                `_plugins_helpers.derive_agent_token_secret`.
 *   * `iss: local`            - dev-mode CLI token; signed with a local
 *                                dev secret. Skips the `agentId` claim
 *                                check, matching the agent mirror.
 *
 * Wire format:
 *   `urlsafe_b64(json_claims_blob).urlsafe_b64(hmac_sha256_sig)`
 * (no `=` padding; restored before decode). Canonical JSON: sorted
 * keys, no whitespace. Matches the agent's `_canonical_claims_blob`.
 */

/** HKDF salt is fixed by spec so the GCS and the agent derive the same
 * secret independently. Mirrors `_plugins_helpers.HKDF_SALT_TOKEN_V1`. */
export const HKDF_SALT_TOKEN_V1 = new TextEncoder().encode(
  "ados/plugin-capability-token/v1",
);

/** Decoded JSON-claim token shape. Matches the agent's `AgentTokenClaims`
 * (snake_case there, camelCase on the wire and in this module). */
export interface TokenClaims {
  pluginId: string;
  agentId: string;
  operatorId: string;
  expiresAt: number;
  grantedCapabilities: ReadonlyArray<string>;
  iss: string;
}

/** Issuer family the verifier resolves the secret for. */
export type IssuerKind = "cloud" | "agent" | "local";

/** What the bridge expects the token to assert. */
export interface ExpectedClaims {
  pluginId: string;
  agentId: string;
}

/** Resolver callback that returns the imported HMAC keys for a given
 * issuer family, current key first. A family whose secret rotates returns
 * the retained previous key after the current one, so a token minted just
 * before a rotation keeps verifying until it expires. The bridge owns
 * secret fetching and caching; this module only verifies. */
export type SecretResolver = (
  kind: IssuerKind,
  issuerSubject: string,
) => Promise<readonly CryptoKey[]>;

/** Raised for any structural, issuer, expiry, scope or signature defect in a
 * capability token. */
export class TokenInvalid extends Error {}

/** Parse a base64-JSON token without verifying its signature. The bridge
 * needs the issuer to know which secret to resolve before calling
 * `verifyToken`. Throws `TokenInvalid` for any structural defect. */
export function parseTokenClaims(
  token: string,
): { claims: TokenClaims; blob: Uint8Array; signature: Uint8Array } {
  if (!token || typeof token !== "string" || token.indexOf(".") === -1) {
    throw new TokenInvalid("malformed token: missing separator");
  }
  const lastDot = token.lastIndexOf(".");
  const blobB64 = token.slice(0, lastDot);
  const sigB64 = token.slice(lastDot + 1);
  if (!blobB64 || !sigB64) {
    throw new TokenInvalid("malformed token: empty segment");
  }

  let blob: Uint8Array;
  let signature: Uint8Array;
  try {
    blob = b64UrlDecodePadless(blobB64);
    signature = b64UrlDecodePadless(sigB64);
  } catch {
    throw new TokenInvalid("malformed token: bad base64");
  }

  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(blob));
  } catch (err) {
    throw new TokenInvalid(`malformed claims: ${(err as Error).message}`);
  }
  if (!raw || typeof raw !== "object") {
    throw new TokenInvalid("claims must be a JSON object");
  }
  const r = raw as Record<string, unknown>;
  const claims: TokenClaims = {
    pluginId: String(r.pluginId ?? ""),
    agentId: String(r.agentId ?? ""),
    operatorId: String(r.operatorId ?? ""),
    expiresAt: Number(r.expiresAt ?? 0),
    grantedCapabilities: Array.isArray(r.grantedCapabilities)
      ? (r.grantedCapabilities as unknown[]).map((c) => String(c))
      : [],
    iss: String(r.iss ?? ""),
  };
  return { claims, blob, signature };
}

/** Classify the issuer into one of the three secret families. */
export function classifyIssuer(
  iss: string,
): { kind: IssuerKind; subject: string } {
  if (iss.startsWith("cloud:")) return { kind: "cloud", subject: iss.slice(6) };
  if (iss.startsWith("agent:")) return { kind: "agent", subject: iss.slice(6) };
  if (iss === "local") return { kind: "local", subject: "" };
  throw new TokenInvalid(`unknown issuer: ${iss}`);
}

/** Verify a token end-to-end. On success returns the decoded claims; on
 * any failure throws `TokenInvalid` with a debug message.
 *
 * Steps:
 *   1. Split + parse claims (delegated to `parseTokenClaims`).
 *   2. Resolve the issuer family.
 *   3. `subtle.verify` HMAC-SHA256 over the canonical claims blob (the
 *      same bytes the agent signed). The Web Crypto API guarantees a
 *      constant-time compare for HMAC verify.
 *   4. Caller-supplied expected claims: `pluginId` must match. `agentId`
 *      must match unless `iss === "local"`. Expiry must be in the future.
 */
export async function verifyToken(
  token: string,
  expected: ExpectedClaims,
  resolver: SecretResolver,
): Promise<TokenClaims> {
  const { claims, blob, signature } = parseTokenClaims(token);
  const { kind, subject } = classifyIssuer(claims.iss);

  const keys = await resolver(kind, subject);
  let ok = false;
  for (const key of keys) {
    ok = await crypto.subtle.verify(
      "HMAC",
      key,
      signature as BufferSource,
      blob as BufferSource,
    );
    if (ok) break;
  }
  if (!ok) {
    throw new TokenInvalid(`${kind} signature mismatch`);
  }

  if (claims.expiresAt <= Date.now()) {
    throw new TokenInvalid("token expired");
  }
  if (claims.pluginId !== expected.pluginId) {
    throw new TokenInvalid(
      `pluginId claim ${claims.pluginId} does not match expected ${expected.pluginId}`,
    );
  }
  if (kind !== "local" && claims.agentId !== expected.agentId) {
    throw new TokenInvalid(
      `agentId claim ${claims.agentId} does not match expected ${expected.agentId}`,
    );
  }
  return claims;
}

/** Derive the agent-issuer HMAC secret from the pairing key.
 *
 * Mirrors the agent's `derive_agent_token_secret`. The Web Crypto API
 * exposes HKDF as a key-derivation algorithm: import the pairing-key
 * bytes as a raw key with usage `"deriveBits"`, then call
 * `deriveBits(HKDF, ...)` with the spec'd salt and 32-byte length.
 */
export async function deriveAgentTokenSecret(
  pairingKey: string | Uint8Array,
): Promise<CryptoKey> {
  const ikm =
    typeof pairingKey === "string"
      ? new TextEncoder().encode(pairingKey)
      : pairingKey;
  if (ikm.length === 0) {
    throw new TokenInvalid(
      "pairing key is empty; agent must be paired to derive token secret",
    );
  }
  const baseKey = await crypto.subtle.importKey(
    "raw",
    ikm as BufferSource,
    { name: "HKDF" },
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: HKDF_SALT_TOKEN_V1 as BufferSource,
      info: new Uint8Array(0) as BufferSource,
    },
    baseKey,
    256,
  );
  return importHmacKey(new Uint8Array(bits));
}

/** Import a raw 32-byte secret as an HMAC-SHA256 verify key. */
export async function importHmacKey(secret: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    secret as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify", "sign"],
  );
}

/** Import a base64-encoded secret as an HMAC-SHA256 verify key. */
export async function importHmacKeyFromBase64(
  secretBase64: string,
): Promise<CryptoKey> {
  return importHmacKey(b64DecodePadless(secretBase64));
}

function b64UrlDecodePadless(s: string): Uint8Array {
  const padded = s + "=".repeat((-s.length) & 3);
  const std = padded.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(std);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64DecodePadless(s: string): Uint8Array {
  const padded = s + "=".repeat((-s.length) & 3);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
