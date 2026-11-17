/**
 * Loopback reaches: a node the browser talks to on this computer.
 *
 * A ground station installed on a personal computer answers `127.0.0.1` only
 * until its owner shares it. That reach is different from a LAN reach in two
 * ways the transport has to know about:
 *
 * 1. **It is not mixed content.** An https page cannot fetch `http://192.168.1.50`
 *    — the browser blocks it — but `http://127.0.0.1` is exempt: loopback is
 *    treated as a priori authenticated. So the secure-page block must not apply
 *    to it.
 * 2. **It needs a private-network grant.** A page on a public origin calling a
 *    loopback address is a request from a public address space to a more-private
 *    one, which Chrome gates behind a permission prompt the page must declare
 *    per request (`targetAddressSpace: "loopback"`). Without the declaration the
 *    request is refused before it is sent.
 *
 * The server-side proxy is the wrong tool here for a second reason: the hosted
 * Mission Control's own server cannot reach the operator's machine, so proxying
 * a loopback node would ask our server to dial `127.0.0.1` on itself. The
 * browser must make the call.
 *
 * @license GPL-3.0-only
 */

/** The request field that declares a more-private address space. Absent from
 *  the DOM typings (it is a Local Network Access proposal, not a standard
 *  member), so it is added to `RequestInit` here rather than cast inline. */
declare global {
  interface RequestInit {
    /** Declares the address space the target sits in. `"loopback"` is the one
     *  the agent's own-computer reach needs. */
    targetAddressSpace?: "local" | "loopback" | "public";
  }
}

/** The hosts that mean "this computer": `localhost`, `127.0.0.0/8` and `[::1]`.
 *  Parsed with `URL`, so a host with a port, a path or credentials is handled
 *  the same way the browser handles it. An unparseable string is not loopback:
 *  the caller then keeps its normal LAN behaviour, which is the safe default. */
export function isLoopbackHost(base: string): boolean {
  let host: string;
  try {
    host = new URL(base.includes("://") ? base : `http://${base}`).hostname;
  } catch {
    return false;
  }
  // `URL.hostname` keeps IPv6 brackets.
  if (host === "[::1]" || host === "::1") return true;
  if (host === "localhost") return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

/** Whether this browser can ask for a loopback reach at all. Chrome and
 *  Electron carry the field on `Request`; Firefox and Safari do not, and there
 *  the hosted page keeps its existing secure-page behaviour for these nodes. */
export function supportsLoopbackReach(): boolean {
  return "targetAddressSpace" in Request.prototype;
}

/**
 * `init`, with the loopback declaration added when `url` is a loopback target.
 * Every request the GCS sends to a node goes through this, so the grant is
 * declared once and never forgotten at a call site.
 */
export function loopbackInit(url: string, init: RequestInit = {}): RequestInit {
  if (!isLoopbackHost(url)) return init;
  return { ...init, targetAddressSpace: "loopback" };
}

/** What the operator is told when their browser refused the loopback grant. */
export const LOOPBACK_PERMISSION_MESSAGE =
  "Allow this site to connect to apps on this device when your browser asks, then try again.";
