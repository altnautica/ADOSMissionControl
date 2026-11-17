/**
 * Whether this browser has refused the loopback-network grant.
 *
 * A page on a public origin calling `127.0.0.1` is a request from a public
 * address space to a more-private one, which Chrome gates behind a permission
 * prompt. Once refused, the request never leaves the page, so nothing on the
 * node side can explain the failure — the surface has to say what to allow.
 *
 * `"unknown"` is the answer everywhere the permission does not exist (Firefox,
 * Safari, an older Chrome): the query throws, and treating a throw as a refusal
 * would tell those operators to fix a prompt their browser never shows.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useState } from "react";

export type LoopbackPermission = "granted" | "denied" | "unknown";

export function useLoopbackPermission(): LoopbackPermission {
  const [state, setState] = useState<LoopbackPermission>("unknown");
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.permissions?.query) return;
    let cancelled = false;
    navigator.permissions
      // Not in the DOM typings: the permission name ships with the same
      // proposal as `targetAddressSpace`, so the cast is the only way to ask.
      .query({ name: "loopback-network" } as unknown as PermissionDescriptor)
      .then((status) => {
        if (cancelled) return;
        setState(status.state === "denied" ? "denied" : "granted");
      })
      .catch(() => {
        if (!cancelled) setState("unknown");
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}
