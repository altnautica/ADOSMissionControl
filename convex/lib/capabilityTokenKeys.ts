/**
 * @module lib/capabilityTokenKeys
 * @description Scoped signing-key derivation for plugin capability tokens.
 * @license GPL-3.0-only
 *
 * The operator's root HMAC secret never leaves the backend. Every capability
 * token is signed with a key derived from that root secret plus the (plugin
 * install, device) pair the token is minted for, and the GCS is handed only
 * the derived key for the pair whose iframe it is hosting. A key lifted out of
 * a browser session therefore forges tokens for exactly the install and drone
 * that operator already mints for — not for every install in the account, and
 * not for a future install either.
 *
 * Derivation is one HMAC-SHA256 over a domain-separated scope string, keyed by
 * the root secret. That is HKDF-Extract in everything that matters here, and
 * it needs only the HMAC primitive the token signer already uses.
 *
 * Both sides call this: the mint path (`cmdPluginCapabilityTokens.mintToken`)
 * and the verification-key read (`operatorHmacSecrets.getMyVerificationKey`).
 * Neither builds the scope string itself, so the two cannot drift.
 *
 * Lives here rather than in `src/lib` because `convex/` is a separate tsconfig
 * project and cannot import across that boundary. Kept byte-identical between
 * the website superset and the OSS twin.
 */

/** Domain separation. Bump the version suffix to invalidate every live key. */
const KEY_LABEL = "ados/plugin-cap-token-key/v1";

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/**
 * Derive the token signing key for one (plugin install, device) pair.
 *
 * `rootSecretBase64` is a row from `operator_hmac_secrets` — either the
 * current secret or, during a rotation overlap, the previous one. The result
 * is base64 of 32 raw bytes, the same shape the signer and the browser-side
 * verifier import.
 */
export async function deriveCapabilityTokenKey(
  rootSecretBase64: string,
  pluginInstallId: string,
  deviceId: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    base64ToBytes(rootSecretBase64) as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const scope = new TextEncoder().encode(
    `${KEY_LABEL}|${pluginInstallId}|${deviceId}`,
  );
  const derived = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, scope as BufferSource),
  );
  return bytesToBase64(derived);
}
