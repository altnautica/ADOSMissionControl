/**
 * @module agent/config-proxy-budget
 * @description Deadlines for the server-side config proxy
 * (`/api/lan-pair/config`), shared by the route and the browser client that
 * calls it. The browser's deadline must sit above the route's own upstream
 * deadline: otherwise the browser aborts a slow-but-successful answer (and
 * reports a write the node applied as failed) before the route can return
 * either the answer or its own honest timeout.
 * @license GPL-3.0-only
 */

/** Route → LAN agent deadline. */
export const CONFIG_PROXY_UPSTREAM_TIMEOUT_MS = 12_000;

/** Route → ground-station relay deadline. The relay lane crosses a WFB radio
 * and the ground station's own relay bound is ~10 s; a deadline at or below it
 * turns a slow radio into a generic network error instead of the station's
 * honest gateway timeout. 15 s sits above that bound and matches the direct
 * relay client. */
export const CONFIG_PROXY_RELAY_UPSTREAM_TIMEOUT_MS = 15_000;

/** Headroom the browser adds over the route's deadline so the route's own
 * answer (success or its timeout body) always arrives first. */
export const CONFIG_PROXY_CLIENT_MARGIN_MS = 2_000;
