/**
 * Capability-token signer for the cloud issuer, kept free of Convex imports so
 * the GCS test suite exercises this exact code against the bridge verifier.
 *
 * Wire format: `urlsafe_b64(canonical_json_blob) + "." + urlsafe_b64(hmac)`.
 * Canonical JSON = sorted top-level keys, no whitespace, matching the agent's
 * `_canonical_claims_blob`; the verifier reads back the exact signed bytes.
 *
 * @license GPL-3.0-only
 */

export interface TokenClaims {
  pluginId: string;
  agentId: string;
  operatorId: string;
  expiresAt: number;
  grantedCapabilities: string[];
  iss: string;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/** URL-safe base64 without `=` padding. */
export function urlsafeB64NoPad(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Sorted top-level keys, no whitespace. */
export function canonicalClaimsBytes(claims: TokenClaims): Uint8Array {
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

/** Sign `claims` with the base64 HMAC-SHA256 secret into the wire token. */
export async function signTokenCanonical(
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
