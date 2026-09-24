/**
 * @module plugins/live-bridge-inputs
 * @description The stable inputs a plugin host hands its envelope dispatcher
 * once per mount, each reading the host's latest props through a ref: the
 * handler set, the token validator, and the refusal logger. A parent that
 * passes fresh object identities every render therefore never tears the
 * dispatcher down (which would drop in-flight RPC). Shared by the iframe and
 * the inline host so both gate calls identically.
 *
 * @license GPL-3.0-only
 */

import type {
  BridgeError,
  BridgeHandler,
  BridgeTokenValidatorOptions,
} from "@/lib/plugins/bridge";

interface Ref<T> {
  readonly current: T;
}

/** A handler table that resolves each method against `ref.current` at call
 * time. Own properties only, so an inherited name such as `constructor`
 * never resolves to an Object.prototype member. */
export function liveHandlers(
  ref: Ref<Record<string, BridgeHandler>>,
): Record<string, BridgeHandler> {
  return new Proxy(
    {},
    {
      get(_t, key: string) {
        return Object.hasOwn(ref.current, key) ? ref.current[key] : undefined;
      },
      has(_t, key: string) {
        return Object.hasOwn(ref.current, key);
      },
      ownKeys() {
        return Reflect.ownKeys(ref.current);
      },
      getOwnPropertyDescriptor(_t, key: string) {
        return Object.getOwnPropertyDescriptor(ref.current, key);
      },
    },
  ) as Record<string, BridgeHandler>;
}

/** A validator whose fields delegate to `ref.current` on every RPC, so token
 * refresh and key rotation flow through without re-mounting. */
export function liveValidator(
  ref: Ref<BridgeTokenValidatorOptions | undefined>,
): BridgeTokenValidatorOptions {
  return {
    get expectedAgentId() {
      return ref.current?.expectedAgentId ?? "";
    },
    secretResolver: (kind, subject) => {
      const v = ref.current;
      if (!v) return Promise.reject(new Error("token validator detached during dispatch"));
      return v.secretResolver(kind, subject);
    },
    now: () => {
      const fn = ref.current?.now;
      return fn ? fn() : Date.now();
    },
    onTokenExpired: () => ref.current?.onTokenExpired?.(),
  };
}

/** Log each refused call once per (reason, method) for the mount's lifetime,
 * so a plugin failing its calls leaves a trace without flooding the console.
 * Messages from other frames are not this plugin's doing and are not logged. */
export function refusalLogger(
  pluginId: string,
): (event: BridgeError & { method?: string }) => void {
  const logged = new Set<string>();
  return (event) => {
    if (event.code === "origin_mismatch") return;
    const key = `${event.code}:${event.method ?? ""}`;
    if (logged.has(key)) return;
    logged.add(key);
    console.warn(
      `Plugin ${pluginId} call refused (${event.code}${event.method ? `, ${event.method}` : ""}): ${event.message}`,
    );
  };
}
