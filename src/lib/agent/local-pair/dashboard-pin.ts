/**
 * @module agent/local-pair/dashboard-pin
 * @description Manage a paired node's DASHBOARD-ACCESS PIN over the LAN. The
 * agent's own web dashboard (`http://<node>:8080`) is unlocked from another
 * device by a 4-digit PIN; Mission Control — which already holds the node's
 * API key — reads the PIN status and can set or reset it. A reset rotates the
 * salt the session tokens are keyed with, so every browser currently unlocked
 * on that node's dashboard is signed out.
 *
 * These hit the agent's `/api/dashboard/pin/{status,set,clear}` routes with the
 * stored API key in the `X-ADOS-Key` header, routed through Mission Control's
 * `/api/lan-pair/*` proxy when a window exists (same reason as the pair flow:
 * HTTPS mixed-content + server-side mDNS resolution).
 * @license GPL-3.0-only
 */

import { PairClientError } from "./errors";
import { normaliseHost, safeJson, shouldUseProxy } from "./transport";
import { loopbackInit } from "@/lib/nodes/loopback";

/** The node's dashboard-PIN posture. */
export interface DashboardPinStatus {
  /** Whether a PIN has been set on this node's dashboard. */
  pinSet: boolean;
  /** Whether the dashboard is currently locked out after failed attempts. */
  locked: boolean;
  /** Unix seconds the lockout expires, when `locked`. */
  lockedUntil: number | null;
  /** `node` when every device is locked out (the node-wide failure budget is
   * spent), `peer` when only the asking device is; null when not locked. */
  lockScope: "node" | "peer" | null;
}

/** Operator copy for a locked dashboard PIN. A node-scope lock refuses every
 * device until it expires or the key holder resets the PIN; a peer lock is
 * only the device that kept guessing. Null when not locked. */
export function dashboardPinLockCopy(
  status: Pick<DashboardPinStatus, "locked" | "lockedUntil" | "lockScope">,
  nowUnixS: number,
): string | null {
  if (!status.locked) return null;
  const wait =
    status.lockedUntil !== null
      ? ` for ${Math.max(1, Math.ceil((status.lockedUntil - nowUnixS) / 60))} min`
      : "";
  return status.lockScope === "node"
    ? `Too many wrong PIN attempts from across the network: the dashboard is locked for every device${wait}. Resetting the PIN here lifts the lock.`
    : `One device entered too many wrong PINs and is locked out${wait}.`;
}

/** Pull a human message out of an agent error body (`{ detail }`). */
async function errorMessage(resp: Response, fallback: string): Promise<string> {
  const body = await safeJson(resp);
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail: unknown }).detail;
    if (typeof detail === "string" && detail) return detail;
  }
  return `${fallback}: ${resp.status} ${resp.statusText}`;
}

/** GET the node's dashboard-PIN status. */
export async function getDashboardPinStatus(
  hostname: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<DashboardPinStatus> {
  const host = normaliseHost(hostname);
  const resp = shouldUseProxy(host)
    ? await fetch(`/api/lan-pair/pin-status`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ host, apiKey }),
        signal,
      })
    : await fetch(
        `${host}/api/dashboard/pin/status`,
        loopbackInit(`${host}/api/dashboard/pin/status`, {
          headers: { "X-ADOS-Key": apiKey, Accept: "application/json" },
          signal,
        }),
      );
  if (!resp.ok) {
    throw new PairClientError(
      "pinStatusFailedError",
      await errorMessage(resp, "Failed to read PIN status"),
      { status: resp.status, statusText: resp.statusText },
    );
  }
  const data = (await safeJson(resp)) as {
    pin_set?: boolean;
    locked?: boolean;
    locked_until?: number | null;
    scope?: string | null;
  } | null;
  return {
    pinSet: !!data?.pin_set,
    locked: !!data?.locked,
    lockedUntil:
      typeof data?.locked_until === "number" ? data.locked_until : null,
    lockScope:
      data?.scope === "node" || data?.scope === "peer" ? data.scope : null,
  };
}

/** Set (or replace) the node's dashboard PIN. The stored API key authorizes the
 * write, so no current PIN is required from Mission Control. */
export async function setDashboardPin(
  hostname: string,
  apiKey: string,
  pin: string,
  signal?: AbortSignal,
): Promise<void> {
  const host = normaliseHost(hostname);
  const resp = shouldUseProxy(host)
    ? await fetch(`/api/lan-pair/pin-set`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ host, apiKey, pin }),
        signal,
      })
    : await fetch(
        `${host}/api/dashboard/pin/set`,
        loopbackInit(`${host}/api/dashboard/pin/set`, {
          method: "POST",
          headers: {
            "X-ADOS-Key": apiKey,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ pin }),
          signal,
        }),
      );
  if (!resp.ok) {
    throw new PairClientError(
      "pinSetFailedError",
      await errorMessage(resp, "Failed to set PIN"),
      { status: resp.status, statusText: resp.statusText },
    );
  }
}

/** Reset (clear) the node's dashboard PIN. Signs out every currently-unlocked
 * browser and re-arms the trust-on-first-use "set a PIN" flow. */
export async function clearDashboardPin(
  hostname: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<void> {
  const host = normaliseHost(hostname);
  const resp = shouldUseProxy(host)
    ? await fetch(`/api/lan-pair/pin-clear`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ host, apiKey }),
        signal,
      })
    : await fetch(
        `${host}/api/dashboard/pin/clear`,
        loopbackInit(`${host}/api/dashboard/pin/clear`, {
          method: "POST",
          headers: { "X-ADOS-Key": apiKey, Accept: "application/json" },
          signal,
        }),
      );
  if (!resp.ok) {
    throw new PairClientError(
      "pinClearFailedError",
      await errorMessage(resp, "Failed to reset PIN"),
      { status: resp.status, statusText: resp.statusText },
    );
  }
}
