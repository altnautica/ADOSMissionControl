/**
 * A stand-in for one bridge mount (one iframe) in handler tests. `dispose()`
 * runs the cleanups handlers registered, like `bridge.dispose()` does.
 */
import type { BridgeMount } from "@/lib/plugins/bridge";

let seq = 0;

export function testMount(): BridgeMount & { dispose(): void } {
  const cleanups: Array<() => void> = [];
  seq += 1;
  return {
    id: `mount-${seq}`,
    onDispose: (cleanup) => {
      cleanups.push(cleanup);
    },
    dispose: () => {
      for (const cleanup of cleanups.splice(0)) cleanup();
    },
  };
}
