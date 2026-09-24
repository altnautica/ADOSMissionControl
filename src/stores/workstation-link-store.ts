/**
 * @module WorkstationLinkStore
 * @description What this GCS provisioned between each paired workstation and
 * each paired drone or ground station: the workstation-issued credential that
 * node now presents on the workstation's lanes.
 *
 * A link records the pairing time of both nodes when it was provisioned, so a
 * re-pair of either (a new owner key on the workstation invalidates every
 * credential it issued; a re-flashed drone lost its store) is seen as a link
 * that must be provisioned again. `revoked` is the operator's own act and is
 * never undone automatically.
 *
 * Only `links` persists. `inFlight` marks the pairs being provisioned right
 * now, so the bridge and a manual re-provision never race on one pair.
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type WorkstationLinkState = "provisioned" | "failed" | "revoked";

export interface WorkstationLink {
  workstationDeviceId: string;
  peerDeviceId: string;
  state: WorkstationLinkState;
  /** The credential id on the workstation (set once issued). */
  credentialId?: string;
  /** Both nodes' `pairedAt` when this link was last provisioned. */
  workstationPairedAt: number;
  peerPairedAt: number;
  /** When the last attempt settled (epoch ms). */
  at: number;
  /** Why the last attempt failed, and on which node. */
  error?: string;
}

interface WorkstationLinkStoreState {
  links: Record<string, WorkstationLink>;
  inFlight: Record<string, true>;
  record: (link: WorkstationLink) => void;
  setInFlight: (key: string, on: boolean) => void;
  /** Drop every link touching a node that is no longer paired. */
  prune: (pairedDeviceIds: readonly string[]) => void;
}

/** The store key of one workstation-to-peer link. */
export function workstationLinkKey(workstationDeviceId: string, peerDeviceId: string): string {
  return `${workstationDeviceId}|${peerDeviceId}`;
}

export const useWorkstationLinkStore = create<WorkstationLinkStoreState>()(
  persist(
    (set) => ({
      links: {},
      inFlight: {},
      record: (link) =>
        set((s) => ({
          links: {
            ...s.links,
            [workstationLinkKey(link.workstationDeviceId, link.peerDeviceId)]: link,
          },
        })),
      setInFlight: (key, on) =>
        set((s) => {
          if (on === Boolean(s.inFlight[key])) return s;
          const inFlight = { ...s.inFlight };
          if (on) inFlight[key] = true;
          else delete inFlight[key];
          return { inFlight };
        }),
      prune: (pairedDeviceIds) =>
        set((s) => {
          const kept = Object.entries(s.links).filter(
            ([, l]) =>
              pairedDeviceIds.includes(l.workstationDeviceId) &&
              pairedDeviceIds.includes(l.peerDeviceId),
          );
          return kept.length === Object.keys(s.links).length
            ? s
            : { links: Object.fromEntries(kept) };
        }),
    }),
    {
      name: "altcmd:workstation-links",
      version: 1,
      partialize: (s) => ({ links: s.links }),
      // v1 is the first shape; a store written under any other version is
      // dropped rather than guessed at (the bridge re-provisions from nothing).
      migrate: () => ({ links: {} }),
    },
  ),
);
