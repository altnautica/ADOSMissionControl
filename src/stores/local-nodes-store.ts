/**
 * @module LocalNodesStore
 * @description Browser-local registry of nodes paired over the LAN
 * without going through Convex. A node here is any agent (drone,
 * ground station, future compute) that the operator paired by
 * pasting a hostname into the Add-a-Node card.
 *
 * Independent of the Convex-backed ``pairing-store`` so the GCS
 * works fully offline. Persisted to localStorage with a version /
 * migrate handler per the project convention.
 *
 * THREAT MODEL (local-first credential storage):
 *   - Each ``LocalNode`` stores an ``apiKey`` returned by the
 *     agent's ``/api/pairing/claim``. This key is the credential
 *     for every subsequent REST call to that agent. localStorage is
 *     plaintext: any XSS that runs on the GCS origin reads every
 *     paired agent's apiKey. Browser-extension access and devtools
 *     see the same.
 *   - There is no key derivation, no encryption at rest, no
 *     hardware-backed key isolation. This is the local-first
 *     trade-off and the pragmatic posture for v1.
 *   - If the operator clears browser storage the apiKeys are lost.
 *     Recovery: run ``ados unpair`` on the node (or release it from
 *     the node's own dashboard under Settings), then pair again from
 *     the GCS.
 *   - See also ``browser-identity-store.ts`` for the per-browser
 *     UUID that acts as pair-owner identifier on the same threat
 *     surface.
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
  /** Drop any node reachable at the same host as `ident` but carrying a
   * different deviceId than `keepDeviceId`. Called at pair time so re-pairing a
   * re-flashed box REPLACES its stale-identity card instead of leaving a second
   * offline ghost behind. */
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
  /** Record that `host` answered for this node, clearing any recorded reach
   * failure. Coalesced on the same interval as `touchLastSeen`. */
  recordReachOk: (deviceId: string, host: string) => void;
  /** Record that `host` did not answer, and why. Leaves `lastReachOk` in
   * place: "the address that used to work" is exactly the fact the operator
   * needs when the current one stops. */
  recordReachError: (deviceId: string, host: string, error: string) => void;
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

export const useLocalNodesStore = create<LocalNodesState>()(
  persist(
    (set) => ({
      nodes: [],
      addNode: (node) =>
        set((state) => {
          const existing = state.nodes.findIndex(
            (n) => n.deviceId === node.deviceId,
          );
          if (existing >= 0) {
            const next = state.nodes.slice();
            next[existing] = { ...next[existing], ...node };
            return { nodes: next };
          }
          return { nodes: [...state.nodes, node] };
        }),
      removeNode: (deviceId) =>
        set((state) => ({
          nodes: state.nodes.filter((n) => n.deviceId !== deviceId),
        })),
      migrateNode: (oldDeviceId, newDeviceId, patch) =>
        set((state) => {
          if (oldDeviceId === newDeviceId) {
            if (!patch) return state;
            return {
              nodes: state.nodes.map((n) =>
                n.deviceId === oldDeviceId ? { ...n, ...patch } : n,
              ),
            };
          }
          const src = state.nodes.find((n) => n.deviceId === oldDeviceId);
          if (!src) return state;
          const migrated: LocalNode = { ...src, ...patch, deviceId: newDeviceId };
          const next: LocalNode[] = [];
          for (const n of state.nodes) {
            if (n.deviceId === oldDeviceId) next.push(migrated);
            else if (n.deviceId === newDeviceId) continue; // collision — migrated wins
            else next.push(n);
          }
          return { nodes: next };
        }),
      reconcileHost: (ident, keepDeviceId) =>
        set((state) => {
          const target = nodeHostKeys(ident);
          if (target.size === 0) return state;
          const next = state.nodes.filter((n) => {
            if (n.deviceId === keepDeviceId) return true;
            const keys = nodeHostKeys(n);
            for (const k of keys) if (target.has(k)) return false;
            return true;
          });
          return next.length !== state.nodes.length ? { nodes: next } : state;
        }),
      renameNode: (deviceId, name) =>
        set((state) => ({
          nodes: state.nodes.map((n) =>
            n.deviceId === deviceId ? { ...n, name } : n,
          ),
        })),
      setNodeRegion: (deviceId, region) =>
        set((state) => ({
          nodes: state.nodes.map((n) =>
            n.deviceId === deviceId ? { ...n, region } : n,
          ),
        })),
      setNodeHostname: (deviceId, hostname) =>
        set((state) => {
          // `hostname` is a BASE URL for every consumer (`AgentClient` appends
          // a path to it verbatim and adds no scheme), so a bare address from
          // a reach block or a settings field is normalised here rather than
          // at each call site.
          const next = normaliseHost(hostname);
          if (!next) return state;
          return {
            nodes: state.nodes.map((n) =>
              n.deviceId === deviceId ? { ...n, hostname: next } : n,
            ),
          };
        }),
      recordReachOk: (deviceId, host) =>
        set((state) => {
          const node = state.nodes.find((n) => n.deviceId === deviceId);
          if (!node) return state;
          const now = Date.now();
          // Coalesce on the same interval as `touchLastSeen` — this runs off
          // the same ~5s poll and rewrites the persisted array. A CHANGE of
          // reach, or a failure that needs clearing, always writes through:
          // those are the two facts the operator is watching for.
          const unchanged =
            node.lastReachOk?.host === host &&
            node.lastReachError === undefined &&
            now - node.lastReachOk.at < PRESENCE_STAMP_MIN_MS;
          if (unchanged) return state;
          return {
            nodes: state.nodes.map((n) =>
              n.deviceId === deviceId
                ? { ...n, lastReachOk: { host, at: now }, lastReachError: undefined }
                : n,
            ),
          };
        }),
      recordReachError: (deviceId, host, error) =>
        set((state) => {
          const node = state.nodes.find((n) => n.deviceId === deviceId);
          if (!node) return state;
          const now = Date.now();
          const unchanged =
            node.lastReachError?.host === host &&
            node.lastReachError.error === error &&
            now - node.lastReachError.at < PRESENCE_STAMP_MIN_MS;
          if (unchanged) return state;
          return {
            nodes: state.nodes.map((n) =>
              n.deviceId === deviceId
                ? { ...n, lastReachError: { host, error, at: now } }
                : n,
            ),
          };
        }),
      touchLastSeen: (deviceId) =>
        set((state) => {
          const now = Date.now();
          const node = state.nodes.find((n) => n.deviceId === deviceId);
          if (!node) return state;
          // Coalesce: skip the rewrite (and its re-render + localStorage write)
          // when the last stamp is still fresh. The 1 Hz clock keeps the node
          // "live" between stamps, so this never flaps the online badge.
          if (node.lastSeenAt && now - node.lastSeenAt < PRESENCE_STAMP_MIN_MS) {
            return state;
          }
          return {
            nodes: state.nodes.map((n) =>
              n.deviceId === deviceId ? { ...n, lastSeenAt: now } : n,
            ),
          };
        }),
      clear: () => set({ nodes: [] }),
    }),
    {
      name: "altcmd:local-nodes",
      version: 5,
      // v1→v2 added ipv4; v2→v3 added optional bindState + radio; v3→v4 added
      // optional region; v4→v5 added optional lastReachOk / lastReachError.
      // All optional additions, so migration is an identity passthrough.
      migrate: (persisted, version) => {
        void version;
        return persisted as LocalNodesState;
      },
    },
  ),
);
