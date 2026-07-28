/**
 * @module LanPairPeerDeviceId
 * @description Validation for the ONE variable path segment any LAN-pair
 * proxy route interpolates from client input: the relay-proxy peer device id
 * in `/api/v1/ground-station/relay-proxy/<peerDeviceId>/...`.
 *
 * A path segment built from a client-supplied string is a path-traversal
 * surface, so it gets an allow-list rather than a deny-list. The vocabulary is
 * taken from `src/lib/protocol/firmware/ap-periph-path.ts` — the repo's
 * existing validator for exactly this situation (a caller-supplied string
 * spliced into an upstream URL path), which pairs the same
 * `/^[A-Za-z0-9._-]+$/` segment charset with an explicit dot-segment refusal.
 * The length ceiling is the agent protocol's own device-id bound
 * (`MAX_DEVICE_ID = 32`, `ados-protocol/src/node_status.rs`), so an id this
 * route accepts is one the aux RPC lane can actually address.
 *
 * Co-located under the route folder and named with a leading underscore so it
 * is never treated as a route (the `_ipv4.ts` convention), and kept out of the
 * route file because App Router route modules export only HTTP-method
 * handlers and route options.
 *
 * @license GPL-3.0-only
 */

/** Segment charset. Anything outside it — a slash, a query or fragment
 * character, whitespace, a `%` percent-encoding, a colon — is refused, so a
 * rejected id never reaches a URL to be normalised or re-decoded. */
const SEGMENT_RE = /^[A-Za-z0-9._-]+$/;

/** Longest device id the aux RPC lane addresses (`MAX_DEVICE_ID`). */
const MAX_PEER_DEVICE_ID = 32;

/**
 * True when `value` is safe to interpolate as a single relay-proxy path
 * segment. A dot is legal inside an id (`SEGMENT_RE` admits it), but a bare
 * `.` or `..` segment is traversal that `fetch`'s URL normalisation would act
 * on, so both are refused outright.
 */
export function isValidPeerDeviceId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > MAX_PEER_DEVICE_ID) return false;
  if (!SEGMENT_RE.test(value)) return false;
  return value !== "." && value !== "..";
}
