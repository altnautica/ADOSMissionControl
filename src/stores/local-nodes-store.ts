/**
 * @module LocalNodesStore
 * @description Browser-local registry of nodes paired over the LAN
 * without going through Convex. A node here is any agent (drone,
 * ground station, future compute) that the operator paired by
 * pasting a hostname into the Add-a-Node card.
 *
 * Independent of the Convex-backed ``pairing-store`` so the GCS
 * works fully offline. Persisted with a version / migrate handler per
 * the project convention, through ``local-nodes-storage``.
 *
 * THREAT MODEL (local-first credential storage):
 *   - Each ``LocalNode`` stores an ``apiKey`` returned by the
 *     agent's ``/api/pairing/claim``. This key is the credential
 *     for every subsequent REST call to that agent.
 *   - Desktop app: the key is sealed with the OS key store
 *     (Electron ``safeStorage``) before it is written, so the profile
 *     directory holds ciphertext. A script running in the app's page
 *     still sees the opened key in memory.
 *   - Web: localStorage is plaintext. Any XSS that runs on the GCS
 *     origin reads every paired agent's apiKey; browser extensions and
 *     devtools see the same.
 *   - A key exists only here, and the agent issues no second one while
 *     paired, so nothing in this store deletes a node that holds a key
 *     on an address match alone (see ``reconcileHost``).
 *   - If the operator clears browser storage the apiKeys are lost.
 *     Recovery: run ``ados unpair`` on the node (or release it from
 *     the node's own dashboard under Settings), then pair again from
 *     the GCS.
 *   - See also ``browser-identity-store.ts`` for the per-browser
 *     UUID that acts as pair-owner identifier on the same threat
 *     surface.
 *
 * CROSS-TAB: every open tab holds the registry. A tab re-reads the store
 * when another tab writes it (``storage`` event → ``persist.rehydrate``),
 * and every mutation is applied to the newest persisted list, merged by
 * device id, so a background tab's presence stamp never writes back a list
 * that is missing a node (and its key) another tab just paired.
 *
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
// From the narrow transport module, not the `local-pair-client` barrel: the
// barrel pulls the whole pair flow (and the mDNS scan) into every consumer of
// this store, and `transport.ts` has no imports of its own.
import { normaliseHost } from "@/lib/agent/local-pair/transport";
import type {
  AgentBindState,
  AgentRadioSnapshot,
} from "@/lib/agent/local-pair-client";
import {
  LOCAL_NODES_STORE_KEY,
  localNodesStorage,
  persistedNodesIfChanged,
  type PersistedLocalNodes,
} from "./local-nodes-storage";

/** Persisted schema version. */
const STORE_VERSION = 6;

/** Reduce any host string (full URL, bare host, mDNS name with a trailing
 * dot, IPv4) to its comparable host key so two ways of naming the same box
 * collapse to one value. `http://192.168.0.5:8080` and the bare `192.168.0.5`
 * both key to `192.168.0.5`. */
function hostKey(value?: string | null): string | null {
  if (!value) return null;
  const s = value.trim();
  if (!s) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `http://${s}`);
    return u.hostname.replace(/\.$/, "").toLowerCase();
  } catch {
    return s.replace(/\.$/, "").toLowerCase();
  }
}

/** Every comparable host key a node can be reached by. */
function nodeHostKeys(ident: {
  hostname?: string;
  ipv4?: string;
  mdnsHost?: string;
}): Set<string> {
  const keys = new Set<string>();
  for (const k of [
    hostKey(ident.hostname),
    hostKey(ident.ipv4),
    hostKey(ident.mdnsHost),
  ]) {
    if (k) keys.add(k);
  }
  return keys;
}

export interface LocalNode {
  /** Stable agent device id from the agent's pairing/info response. */
  deviceId: string;
  /** Human-readable name from the agent (operator can edit later). */
  name: string;
  /** Base URL (no trailing slash) the GCS uses to reach this agent. */
  hostname: string;
  /** API key returned by ``/api/pairing/claim`` for this browser. */
  apiKey: string;
  /** Wire-contract profile from ``/api/pairing/info``. */
  profile: "drone" | "ground-station" | "workstation";
  /** Ground-station role when applicable. */
  role?: "direct" | "relay" | "receiver" | null;
  /** Board name from the agent (e.g. "Raspberry Pi 4B"). */
  board?: string;
  /** Agent version string at pair time. */
  version?: string;
  /** mDNS hostname the agent reports for itself. Only ever as good as what
   * the agent publishes — treat it as a candidate reach, not a proven one;
   * `lastReachOk` records which reach actually answered. */
  mdnsHost?: string;
  /** Server-resolved IPv4 captured at pair time. Used as a fallback
   * when the browser stops resolving the .local hostname (Safari,
   * Firefox without permission, Brave strict mode). Undefined for
   * pre-schema-v2 entries — the user re-pairs to populate. */
  ipv4?: string;
  /** When the operator paired this node (epoch ms). */
  pairedAt: number;
  /** Last time the GCS confirmed reachability (epoch ms). */
  lastSeenAt?: number;
  /** Radio bind progress captured at pair time. Optional — older
   * entries and agents that don't advertise it carry undefined. */
  bindState?: AgentBindState;
  /** Radio link snapshot captured at pair time. Optional. */
  radio?: AgentRadioSnapshot;
  /** Operator-pinned operating region (ISO 3166-1 alpha-2, e.g. "US") for
   * this node, or null for the unrestricted default. Remembered so a
   * re-pair / re-flash of the same node can re-apply the operator's choice.
   * Undefined for entries paired before this field existed. */
  region?: string | null;
  /** The reach that last answered a probe, and when. This is the only field
   * that records an address as PROVEN rather than merely stored: a node
   * carries up to three candidate reaches (`hostname`, `mdnsHost`, `ipv4`)
   * and different consumers pick different ones, so without this an operator
   * cannot tell which address is carrying their session — nor, when a node
   * greys out, whether the agent is down, the `.local` name stopped
   * resolving, or the DHCP lease moved. Written by the LAN fleet bridge on
   * every successful probe. */
  lastReachOk?: { host: string; at: number };
  /** The reach that last failed, why, and when. Cleared the moment any reach
   * succeeds, so its presence means "the stored address is not answering
   * right now" and never a stale scare. */
  lastReachError?: { host: string; error: string; at: number };
  /** When the node last answered an authenticated call by refusing this
   * browser's key (401 / 403). The node is up; the key no longer opens it, so
   * the recovery is a re-pair. Cleared by the next accepted call or a new key. */
  keyRejectedAt?: number;
  /** Another agent now answers at this node's stored address (a DHCP lease
   * moved to a different box, or this box was re-flashed under a new id).
   * Recorded instead of deleting the node so its key survives; cleared when
   * the stored address answers as this node again or the address changes. */
  hostTakenBy?: { deviceId: string; at: number };
}

interface LocalNodesState {
  nodes: LocalNode[];
  addNode: (node: LocalNode) => void;
  removeNode: (deviceId: string) => void;
  /** Rename a node's stable identity in place (old → new deviceId), preserving
   * its hostname / apiKey / name and applying an optional patch. Used when the
   * box at a known host comes back with a fresh device id (re-flash) but the
   * stored key still validates — the card is the same paired box, just
   * re-identified, so heal it rather than orphan it. Any pre-existing node that
   * already holds the new id is dropped (the migrated node wins). */
  migrateNode: (
    oldDeviceId: string,
    newDeviceId: string,
    patch?: Partial<LocalNode>,
  ) => void;
  /** Called at pair time with the newly paired node's addresses. Every other
   * node reachable at one of those addresses is no longer at it: a node that
   * holds a key is marked `hostTakenBy` (its key is the only one this browser
   * has, so it is never deleted on an address match), and a keyless leftover
   * is dropped. */
  reconcileHost: (
    ident: { hostname?: string; ipv4?: string; mdnsHost?: string },
    keepDeviceId: string,
  ) => void;
  renameNode: (deviceId: string, name: string) => void;
  /** Record the operator-pinned operating region for a node (null =
   * unrestricted) so a re-pair / re-flash re-applies it. */
  setNodeRegion: (deviceId: string, region: string | null) => void;
  /** Rewrite the base URL the GCS reaches this node at. Backs the reach
   * block's "use this address" action, so an operator whose `.local` name
   * stopped resolving can switch the node onto the IP that answered without
   * re-pairing (which would mint a new key and orphan the card). */
  setNodeHostname: (deviceId: string, hostname: string) => void;
  /** Record that `host` answered as this node, clearing any recorded reach
   * failure and any `hostTakenBy`. Coalesced on the same interval as
   * `touchLastSeen`. */
  recordReachOk: (deviceId: string, host: string) => void;
  /** Record that `host` did not answer, and why. Leaves `lastReachOk` in
   * place: "the address that used to work" is exactly the fact the operator
   * needs when the current one stops. */
  recordReachError: (deviceId: string, host: string, error: string) => void;
  /** Record that a different agent (`byDeviceId`) answers at this node's
   * stored address. */
  markHostTaken: (deviceId: string, byDeviceId: string) => void;
  /** Record whether the node refused this browser's key on its last
   * authenticated call. Writes only on a change. */
  setKeyRejected: (deviceId: string, rejected: boolean) => void;
  touchLastSeen: (deviceId: string) => void;
  clear: () => void;
}

/**
 * Minimum interval between presence stamps. `touchLastSeen` rebuilds the
 * persisted `nodes` array (which re-renders every fleet subscriber AND writes
 * localStorage), so stamping on every ~5s poll churned the whole UI. Online /
 * stale state already flips live off the 1 Hz clock reading `now - lastSeenAt`,
 * so a fresh stamp is only needed well under STALE_THRESHOLD_MS (45s). Coalesce
 * to 20s: presence stays live, the array identity changes at most every 20s.
 */
const PRESENCE_STAMP_MIN_MS = 20_000;

/**
 * Time of the latest successful reach per device, updated on every success
 * and never persisted. `lastReachOk.at` is coalesced to one write per
 * {@link PRESENCE_STAMP_MIN_MS}, so it is the first success of the window;
 * the "reached … ago" label reads this instead and stays near 0 s on a node
 * that answers every poll.
 */
export const useReachOkLiveStore = create<{ at: Record<string, number> }>(() => ({ at: {} }));

/** Rewrite one node, or return `nodes` itself when it is absent. */
function patchNode(
  nodes: LocalNode[],
  deviceId: string,
  patch: (n: LocalNode) => LocalNode,
): LocalNode[] {
  if (!nodes.some((n) => n.deviceId === deviceId)) return nodes;
  return nodes.map((n) => (n.deviceId === deviceId ? patch(n) : n));
}

export const useLocalNodesStore = create<LocalNodesState>()(
  persist(
    (set) => {
      /** Apply `change` to the newest node list and publish the result. The
       * newest list is the persisted one when another tab wrote after this
       * tab did: it is the authority per device id (an id missing from it was
       * removed there), so this tab's mutation lands on top of it rather than
       * replacing it. `change` returns its input unchanged for a no-op. */
      const update = (change: (nodes: LocalNode[]) => LocalNode[]) =>
        set((state) => {
          const base = persistedNodesIfChanged(STORE_VERSION) ?? state.nodes;
          const next = change(base);
          return next === state.nodes ? state : { nodes: next };
        });

      return {
        nodes: [],
        addNode: (node) =>
          update((nodes) => {
            const existing = nodes.findIndex((n) => n.deviceId === node.deviceId);
            if (existing < 0) return [...nodes, node];
            const prev = nodes[existing];
            const next = nodes.slice();
            // A new key has not been refused, and a new address has not been
            // taken by anyone.
            const keyRejectedAt =
              node.apiKey !== prev.apiKey
                ? node.keyRejectedAt
                : (node.keyRejectedAt ?? prev.keyRejectedAt);
            const hostTakenBy =
              node.hostname !== prev.hostname
                ? node.hostTakenBy
                : (node.hostTakenBy ?? prev.hostTakenBy);
            next[existing] = { ...prev, ...node, keyRejectedAt, hostTakenBy };
            return next;
          }),
        removeNode: (deviceId) =>
          update((nodes) =>
            nodes.some((n) => n.deviceId === deviceId)
              ? nodes.filter((n) => n.deviceId !== deviceId)
              : nodes,
          ),
        migrateNode: (oldDeviceId, newDeviceId, patch) =>
          update((nodes) => {
            if (oldDeviceId === newDeviceId) {
              return patch ? patchNode(nodes, oldDeviceId, (n) => ({ ...n, ...patch })) : nodes;
            }
            const src = nodes.find((n) => n.deviceId === oldDeviceId);
            if (!src) return nodes;
            const migrated: LocalNode = { ...src, ...patch, deviceId: newDeviceId };
            const next: LocalNode[] = [];
            for (const n of nodes) {
              if (n.deviceId === oldDeviceId) next.push(migrated);
              else if (n.deviceId === newDeviceId) continue; // collision — migrated wins
              else next.push(n);
            }
            return next;
          }),
        reconcileHost: (ident, keepDeviceId) =>
          update((nodes) => {
            const target = nodeHostKeys(ident);
            if (target.size === 0) return nodes;
            const at = Date.now();
            let changed = false;
            const next: LocalNode[] = [];
            for (const n of nodes) {
              const shares =
                n.deviceId !== keepDeviceId &&
                [...nodeHostKeys(n)].some((k) => target.has(k));
              if (!shares) {
                next.push(n);
                continue;
              }
              changed = true;
              if (n.apiKey) next.push({ ...n, hostTakenBy: { deviceId: keepDeviceId, at } });
            }
            return changed ? next : nodes;
          }),
        renameNode: (deviceId, name) =>
          update((nodes) => patchNode(nodes, deviceId, (n) => ({ ...n, name }))),
        setNodeRegion: (deviceId, region) =>
          update((nodes) => patchNode(nodes, deviceId, (n) => ({ ...n, region }))),
        setNodeHostname: (deviceId, hostname) =>
          update((nodes) => {
            // `hostname` is a BASE URL for every consumer (`AgentClient` appends
            // a path to it verbatim and adds no scheme), so a bare address from
            // a reach block or a settings field is normalised here rather than
            // at each call site.
            const next = normaliseHost(hostname);
            if (!next) return nodes;
            return patchNode(nodes, deviceId, (n) =>
              n.hostname === next ? n : { ...n, hostname: next, hostTakenBy: undefined },
            );
          }),
        recordReachOk: (deviceId, host) => {
          const now = Date.now();
          useReachOkLiveStore.setState((s) => ({ at: { ...s.at, [deviceId]: now } }));
          update((nodes) => {
            const node = nodes.find((n) => n.deviceId === deviceId);
            if (!node) return nodes;
            // Coalesce on the same interval as `touchLastSeen` — this runs off
            // the same ~5s poll and rewrites the persisted array. A CHANGE of
            // reach, or a failure that needs clearing, always writes through:
            // those are the two facts the operator is watching for.
            const unchanged =
              node.lastReachOk?.host === host &&
              node.lastReachError === undefined &&
              node.hostTakenBy === undefined &&
              now - node.lastReachOk.at < PRESENCE_STAMP_MIN_MS;
            if (unchanged) return nodes;
            return patchNode(nodes, deviceId, (n) => ({
              ...n,
              lastReachOk: { host, at: now },
              lastReachError: undefined,
              hostTakenBy: undefined,
            }));
          });
        },
        recordReachError: (deviceId, host, error) =>
          update((nodes) => {
            const node = nodes.find((n) => n.deviceId === deviceId);
            if (!node) return nodes;
            const now = Date.now();
            const unchanged =
              node.lastReachError?.host === host &&
              node.lastReachError.error === error &&
              now - node.lastReachError.at < PRESENCE_STAMP_MIN_MS;
            if (unchanged) return nodes;
            return patchNode(nodes, deviceId, (n) => ({
              ...n,
              lastReachError: { host, error, at: now },
            }));
          }),
        markHostTaken: (deviceId, byDeviceId) =>
          update((nodes) => {
            const node = nodes.find((n) => n.deviceId === deviceId);
            if (!node || node.hostTakenBy?.deviceId === byDeviceId) return nodes;
            return patchNode(nodes, deviceId, (n) => ({
              ...n,
              hostTakenBy: { deviceId: byDeviceId, at: Date.now() },
            }));
          }),
        setKeyRejected: (deviceId, rejected) =>
          update((nodes) => {
            const node = nodes.find((n) => n.deviceId === deviceId);
            if (!node || (node.keyRejectedAt !== undefined) === rejected) return nodes;
            return patchNode(nodes, deviceId, (n) => ({
              ...n,
              keyRejectedAt: rejected ? Date.now() : undefined,
            }));
          }),
        touchLastSeen: (deviceId) =>
          update((nodes) => {
            const now = Date.now();
            const node = nodes.find((n) => n.deviceId === deviceId);
            if (!node) return nodes;
            // Coalesce: skip the rewrite (and its re-render) when the last
            // stamp is still fresh. The 1 Hz clock keeps the node "live"
            // between stamps, so this never flaps the online badge.
            if (node.lastSeenAt && now - node.lastSeenAt < PRESENCE_STAMP_MIN_MS) {
              return nodes;
            }
            return patchNode(nodes, deviceId, (n) => ({ ...n, lastSeenAt: now }));
          }),
        clear: () => set({ nodes: [] }),
      };
    },
    {
      name: LOCAL_NODES_STORE_KEY,
      version: STORE_VERSION,
      storage: localNodesStorage,
      partialize: (state): PersistedLocalNodes => ({ nodes: state.nodes }),
      // v1→v2 added ipv4; v2→v3 added optional bindState + radio; v3→v4 added
      // optional region; v4→v5 added optional lastReachOk / lastReachError;
      // v5→v6 added optional keyRejectedAt / hostTakenBy. All optional
      // additions, so migration is an identity passthrough.
      migrate: (persisted, version) => {
        void version;
        return persisted as PersistedLocalNodes;
      },
    },
  ),
);

// Another tab wrote the registry: take its list, so a node it paired (and the
// key that exists nowhere else) shows up here and is never written over.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === LOCAL_NODES_STORE_KEY || event.key === null) {
      void useLocalNodesStore.persist.rehydrate();
    }
  });
}
