// ws-guard.ts — admission control for a local MAVLink WebSocket server
// SPDX-License-Identifier: GPL-3.0-only
//
// A WebSocket is not CORS-gated: any web page the operator opens can dial
// ws://localhost:<port>. Every bridge socket therefore requires a per-run
// random token in the `?token=` query parameter, and refuses a browser Origin
// that is not a loopback page or one the operator allowed explicitly. Clients
// without an Origin header (command-line tools, scripts) are not browsers and
// only need the token.

import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

/** Default WebSocket bind address: loopback only. */
export const DEFAULT_WS_HOST = '127.0.0.1';

export interface WsGuardOptions {
  /** Token every client must present as `?token=`. */
  token: string;
  /** Extra exact origins (e.g. a hosted GCS) allowed besides loopback pages. */
  allowedOrigins?: readonly string[];
}

export interface WsRefusal {
  code: 401 | 403;
  reason: string;
}

/** A fresh URL-safe random token for one bridge run. */
export function createBridgeToken(): string {
  return randomBytes(18).toString('base64url');
}

/** Whether `origin` is an http(s) page served from a loopback host. */
export function isLoopbackOrigin(origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  return url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
}

/** Constant-time token comparison. */
function tokenMatches(presented: string | null, expected: string): boolean {
  if (presented === null) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Decide whether an upgrade request may open a bridge socket; null admits it. */
export function checkWsClient(req: IncomingMessage, opts: WsGuardOptions): WsRefusal | null {
  const origin = req.headers.origin;
  if (origin !== undefined && !isLoopbackOrigin(origin) && !opts.allowedOrigins?.includes(origin)) {
    return { code: 403, reason: 'Origin not allowed' };
  }
  const token = new URL(req.url ?? '/', 'http://bridge.invalid').searchParams.get('token');
  if (!tokenMatches(token, opts.token)) {
    return { code: 401, reason: 'Missing or invalid token' };
  }
  return null;
}

/** A `ws` `verifyClient` callback enforcing {@link checkWsClient}. */
export function wsVerifyClient(
  opts: WsGuardOptions,
): (
  info: { req: IncomingMessage },
  done: (ok: boolean, code?: number, message?: string) => void,
) => void {
  return (info, done) => {
    const refusal = checkWsClient(info.req, opts);
    if (refusal) done(false, refusal.code, refusal.reason);
    else done(true);
  };
}

/** The URL a GCS dials to reach a bridge bound to `host:port`. */
export function bridgeUrl(host: string, port: number, token: string): string {
  let shown = host;
  if (host === '0.0.0.0' || host === '::' || host === '') shown = 'localhost';
  else if (host.includes(':')) shown = `[${host}]`;
  return `ws://${shown}:${port}/?token=${token}`;
}
