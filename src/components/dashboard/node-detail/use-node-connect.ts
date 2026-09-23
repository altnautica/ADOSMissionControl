"use client";

/**
 * @module node-detail/use-node-connect
 * @description Keeps the focused node's agent connected. Selection is the
 * single driver of the agent connection: focusing a node connects it,
 * switching nodes tears the prior one down, and unfocusing (or unmount)
 * releases it. Demo keeps its single mock agent untouched.
 *
 * A connect is judged by its outcome, not by whether a LAN client exists: a
 * cloud selection opens a subscription and never has one, and liveness there
 * is the cloud status bridge's job. A connect that fails is retried every
 * {@link CONNECT_RETRY_MS} for as long as the node stays focused; a node the
 * browser cannot reach at all (missing credentials, an unpaired relaying
 * ground station) is not retried, since its reason is already on screen.
 *
 * The effect keys on the node's reach (how it is connected), not on the fleet
 * list, which is rebuilt on every telemetry update: re-keying on that tore
 * the session down and redialled it many times a second.
 * @license GPL-3.0-only
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { isDemoMode } from "@/lib/utils";
import { selectNode } from "@/lib/agent/node-click-handler";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import type { FleetNodeEntry } from "@/hooks/use-fleet-nodes";

/** Fixed retry interval for a connect that did not reach the agent. */
export const CONNECT_RETRY_MS = 3_000;

/** The facts that decide how a node is dialled. A change in any of them
 * re-dials; anything else about the entry does not. */
function reachKey(entry: FleetNodeEntry | null): string | null {
  if (!entry) return null;
  return [entry.deviceId, entry.isLocal, entry.isRelayed ?? false, entry.reachedVia ?? ""].join("|");
}

export function useNodeConnect(
  focusDeviceId: string | null,
  focusEntry: FleetNodeEntry | null,
): { connectFailing: boolean; retryNow: () => void } {
  const key = reachKey(focusEntry);
  const entryRef = useRef(focusEntry);
  useEffect(() => {
    entryRef.current = focusEntry;
  });

  const dialledFor = useRef<string | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [retryTick, setRetryTick] = useState(0);
  // The node whose last connect failed. Keyed by device so focusing another
  // node reads clean without resetting anything.
  const [failingFor, setFailingFor] = useState<string | null>(null);

  const clearRetry = () => {
    if (retryTimer.current) {
      clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }
  };

  useEffect(() => {
    if (isDemoMode()) return;
    if (!focusDeviceId) {
      if (dialledFor.current) {
        useAgentConnectionStore.getState().disconnect();
        dialledFor.current = null;
      }
      return;
    }
    if (dialledFor.current === focusDeviceId) return;
    const entry = entryRef.current;
    if (!entry || key === null) return;
    clearRetry();
    // Every post-await step is guarded on this: a later run (another node, or
    // a retry) claims `dialledFor`, and a stale outcome must not touch it.
    const forDevice = focusDeviceId;
    dialledFor.current = forDevice;
    void (async () => {
      const outcome = await selectNode(entry, { onFocusAgent: () => {} });
      if (dialledFor.current !== forDevice) return;
      if (outcome !== "failed") {
        setFailingFor(null);
        return;
      }
      dialledFor.current = null;
      setFailingFor(forDevice);
      retryTimer.current = setTimeout(() => setRetryTick((n) => n + 1), CONNECT_RETRY_MS);
    })();
  }, [focusDeviceId, key, retryTick]);

  // A retry armed for the old node never fires against the new one.
  useEffect(() => clearRetry, [focusDeviceId]);

  useEffect(
    () => () => {
      clearRetry();
      if (!isDemoMode()) {
        useAgentConnectionStore.getState().disconnect();
        dialledFor.current = null;
      }
    },
    [],
  );

  const retryNow = useCallback(() => {
    clearRetry();
    dialledFor.current = null;
    setFailingFor(null);
    setRetryTick((n) => n + 1);
  }, []);

  return { connectFailing: failingFor !== null && failingFor === focusDeviceId, retryNow };
}
