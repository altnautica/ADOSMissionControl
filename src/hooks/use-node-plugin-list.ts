"use client";

/**
 * @module use-node-plugin-list
 * @description A LAN-paired node's own install list (`GET /api/plugins`), the
 * source of truth for what is installed on that node and in which state. A
 * plugin installed by the agent installer, by `ados plugin install`, or from
 * another browser is listed exactly like one installed from this browser.
 *
 * The list is polled on a fixed interval for as long as any component reads
 * it, so an install, removal, enable or disable made anywhere converges here,
 * and an unreachable node is simply retried on the next tick. Every reader of
 * one node shares one poll.
 *
 * @license GPL-3.0-only
 */

import { useCallback, useMemo, useSyncExternalStore } from "react";

import { isDemoMode } from "@/lib/utils";
import { useLocalNodesStore } from "@/stores/local-nodes-store";
import { PluginAgentClient } from "@/lib/agent/plugin-client";
import type { PluginAgentManifestDetail } from "@/lib/agent/plugin-client-types";

/** One install row as the agent lists it. */
export type NodePluginInstall = PluginAgentManifestDetail["install"];

/** Fixed re-read interval for a node's install list. */
export const NODE_PLUGIN_LIST_POLL_MS = 5_000;

/** One polled node, alive while anything reads it. */
interface ListEntry {
  /** Null until the node first answers. */
  rows: NodePluginInstall[] | null;
  /** Serialized `rows`, so an unchanged answer keeps its array identity. */
  serialized: string;
  inflight: boolean;
  listeners: Set<() => void>;
  stop: () => void;
}

const entries = new Map<string, ListEntry>();

function entryKey(agentUrl: string, apiKey: string): string {
  return `${agentUrl}\n${apiKey}`;
}

function readList(entry: ListEntry, agentUrl: string, apiKey: string): void {
  if (entry.inflight) return;
  entry.inflight = true;
  new PluginAgentClient(agentUrl, apiKey)
    .list()
    .then(({ installs }) => {
      const serialized = JSON.stringify(installs);
      if (entry.rows !== null && serialized === entry.serialized) return;
      entry.rows = installs;
      entry.serialized = serialized;
      for (const listener of entry.listeners) listener();
    })
    // A failed read keeps the last answer; the next tick retries.
    .catch(() => {})
    .finally(() => {
      entry.inflight = false;
    });
}

function subscribeList(
  agentUrl: string,
  apiKey: string,
  listener: () => void,
): () => void {
  const key = entryKey(agentUrl, apiKey);
  let entry = entries.get(key);
  if (!entry) {
    const created: ListEntry = {
      rows: null,
      serialized: "",
      inflight: false,
      listeners: new Set(),
      stop: () => {},
    };
    readList(created, agentUrl, apiKey);
    const timer = setInterval(
      () => readList(created, agentUrl, apiKey),
      NODE_PLUGIN_LIST_POLL_MS,
    );
    created.stop = () => clearInterval(timer);
    entries.set(key, created);
    entry = created;
  }
  const held = entry;
  held.listeners.add(listener);
  return () => {
    held.listeners.delete(listener);
    if (held.listeners.size > 0) return;
    held.stop();
    entries.delete(key);
  };
}

const noopUnsubscribe = () => {};

/**
 * The install list `deviceId`'s LAN-paired agent reports. Null for no device,
 * in demo mode, for a node this browser holds no LAN pairing for, and until
 * the node first answers.
 */
export function useNodePluginList(
  deviceId: string | null,
): NodePluginInstall[] | null {
  const node = useLocalNodesStore((s) =>
    deviceId ? s.nodes.find((n) => n.deviceId === deviceId) : undefined,
  );
  const agentUrl =
    deviceId && !isDemoMode() && node?.hostname && node.apiKey ? node.hostname : null;
  const apiKey = agentUrl ? (node?.apiKey ?? "") : "";

  const subscribe = useCallback(
    (listener: () => void) =>
      agentUrl ? subscribeList(agentUrl, apiKey, listener) : noopUnsubscribe,
    [agentUrl, apiKey],
  );
  const getSnapshot = useCallback(
    () => (agentUrl ? (entries.get(entryKey(agentUrl, apiKey))?.rows ?? null) : null),
    [agentUrl, apiKey],
  );
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}

/** Every LAN-paired node's install list, keyed by device id. A node appears
 * once it has answered; empty in demo mode. */
export type NodePluginLists = Readonly<Record<string, NodePluginInstall[]>>;

const NO_LISTS: NodePluginLists = Object.freeze({});

interface ListTarget {
  deviceId: string;
  agentUrl: string;
  apiKey: string;
}

/** The last snapshot built per target set, so an unchanged poll hands back
 * the same object and does not re-render the reader. */
const fleetSnapshots = new WeakMap<
  readonly ListTarget[],
  { rows: Array<NodePluginInstall[] | null>; lists: NodePluginLists }
>();

function readFleetSnapshot(targets: readonly ListTarget[]): NodePluginLists {
  const rows = targets.map((t) => entries.get(entryKey(t.agentUrl, t.apiKey))?.rows ?? null);
  const last = fleetSnapshots.get(targets);
  if (last && rows.every((r, i) => r === last.rows[i])) return last.lists;
  const lists: Record<string, NodePluginInstall[]> = {};
  targets.forEach((t, i) => {
    const answered = rows[i];
    if (answered) lists[t.deviceId] = answered;
  });
  fleetSnapshots.set(targets, { rows, lists });
  return lists;
}

/**
 * The install list of every node this browser holds a LAN pairing for, for
 * the fleet-wide "what is installed where" views. Shares each node's poll
 * with `useNodePluginList`.
 */
export function useLanNodePluginLists(): NodePluginLists {
  const nodes = useLocalNodesStore((s) => s.nodes);
  const targets = useMemo<ListTarget[]>(
    () =>
      isDemoMode()
        ? []
        : nodes
            .filter((n) => n.hostname && n.apiKey)
            .map((n) => ({ deviceId: n.deviceId, agentUrl: n.hostname, apiKey: n.apiKey })),
    [nodes],
  );

  const subscribe = useCallback(
    (listener: () => void) => {
      const unsubscribes = targets.map((t) => subscribeList(t.agentUrl, t.apiKey, listener));
      return () => {
        for (const unsubscribe of unsubscribes) unsubscribe();
      };
    },
    [targets],
  );
  const getSnapshot = useCallback(() => readFleetSnapshot(targets), [targets]);
  return useSyncExternalStore(subscribe, getSnapshot, () => NO_LISTS);
}
