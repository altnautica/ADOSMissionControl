/**
 * Per-iframe state for handlers shared by every panel of one plugin.
 *
 * A plugin's handler set is built once and handed to every iframe the plugin
 * mounts, so state such as "the telemetry subscription for `battery`" must be
 * held per mount, or a second panel's subscribe would replace the first
 * panel's. `perMount` keeps one state value per {@link BridgeMount}, creates it
 * on first use, tears it down when that mount disposes, and tears every one
 * down when the handler set itself is disposed.
 *
 * @module plugins/handlers/per-mount
 * @license GPL-3.0-only
 */

import type { BridgeMount } from "@/lib/plugins/bridge";

export interface PerMount<T> {
  /** The mount's state, created (and its teardown registered) on first use. */
  get(mount: BridgeMount): T;
  /** The mount's state if it has any. */
  peek(mount: BridgeMount): T | undefined;
  /** Every live mount's state. */
  values(): IterableIterator<T>;
  /** Tear down every mount's state. */
  disposeAll(): void;
}

export function perMount<T>(
  create: (mount: BridgeMount) => T,
  teardown: (state: T) => void,
): PerMount<T> {
  const states = new Map<BridgeMount, T>();
  const release = (mount: BridgeMount) => {
    const state = states.get(mount);
    if (state === undefined) return;
    states.delete(mount);
    teardown(state);
  };
  return {
    get(mount) {
      let state = states.get(mount);
      if (state === undefined) {
        state = create(mount);
        states.set(mount, state);
        mount.onDispose(() => release(mount));
      }
      return state;
    },
    peek: (mount) => states.get(mount),
    values: () => states.values(),
    disposeAll() {
      for (const mount of Array.from(states.keys())) release(mount);
    },
  };
}
