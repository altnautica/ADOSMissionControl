import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Short-lived, device-scoped viewer tokens.
 *
 * Wire form: `<exp>.<mac>`, where `exp` is the expiry in unix seconds and
 * `mac` is the lowercase hex HMAC-SHA256 of `${deviceId}|${exp}` keyed with
 * the relay secret. The deviceId is bound into the MAC, so a token minted for
 * one device never opens another device's stream, and the expiry is bound in
 * too, so it cannot be extended by editing the prefix.
 *
 * The Convex deployment mints these tokens with Web Crypto; this module is
 * the relay's side and must stay byte-compatible with it.
 */

/**
 * Longest lifetime the relay accepts, measured from now. A token whose expiry
 * sits further out than this was not minted by the short-lived minter and is
 * refused, so a leaked long-dated token is worthless.
 */
export const MAX_VIEWER_TOKEN_TTL_S = 600;

const TOKEN_PATTERN = /^([1-9]\d{0,11})\.([0-9a-f]{64})$/;

function mac(deviceId: string, exp: number, secret: string): string {
  return createHmac("sha256", secret).update(`${deviceId}|${exp}`).digest("hex");
}

/** The token that authorises opening exactly one device's stream until `exp`. */
export function signViewerToken(deviceId: string, exp: number, secret: string): string {
  return `${exp}.${mac(deviceId, exp, secret)}`;
}

/**
 * Whether `token` authorises opening `deviceId`'s stream at `nowS` (unix
 * seconds). False for an empty secret, a malformed token, an expired token, a
 * token dated beyond the accepted lifetime, and a token for another device.
 */
export function verifyViewerToken(
  token: string,
  deviceId: string,
  secret: string,
  nowS: number,
): boolean {
  if (!secret) return false;
  const match = TOKEN_PATTERN.exec(token);
  if (!match) return false;
  const exp = Number(match[1]);
  if (exp <= nowS || exp > nowS + MAX_VIEWER_TOKEN_TTL_S) return false;
  const presented = Buffer.from(match[2], "hex");
  const expected = Buffer.from(mac(deviceId, exp, secret), "hex");
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}
