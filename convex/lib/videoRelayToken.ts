/**
 * Short-lived viewer tokens for the cloud video relay.
 *
 * Wire form: `<exp>.<mac>`, where `exp` is the expiry in unix seconds and
 * `mac` is the lowercase hex HMAC-SHA256 of `${deviceId}|${exp}` keyed with
 * `VIDEO_RELAY_SECRET`. The relay recomputes the MAC for the device in the
 * stream path and refuses a token that is expired, dated more than ten minutes
 * out, or scoped to another device.
 *
 * Crypto: Web Crypto (`crypto.subtle`), no "use node" needed.
 *
 * @license GPL-3.0-only
 */

/** Lifetime of a minted token. Well inside the relay's ten-minute ceiling. */
export const VIDEO_RELAY_TOKEN_TTL_S = 300;

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

/**
 * Mint a token for `deviceId` that expires `VIDEO_RELAY_TOKEN_TTL_S` after
 * `nowMs`. Returns the token and its expiry in epoch milliseconds.
 */
export async function mintVideoRelayToken(
  deviceId: string,
  secret: string,
  nowMs: number,
): Promise<{ token: string; expiresAt: number }> {
  const exp = Math.floor(nowMs / 1000) + VIDEO_RELAY_TOKEN_TTL_S;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(`${deviceId}|${exp}`));
  return { token: `${exp}.${toHex(new Uint8Array(sig))}`, expiresAt: exp * 1000 };
}
