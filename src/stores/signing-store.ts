/**
 * Per-drone MAVLink signing state.
 *
 * Authoritative state lives in two places:
 *   - Capability + require flag + FC counters: polled from the agent.
 *   - Browser key presence, keyId, enrolled_at, enrollment state:
 *     read from the IndexedDB keystore (`signing-keystore.ts`).
 *
 * This store is the React-facing aggregation of both.
 *
 * @module stores/signing-store
 */

import { create } from "zustand";
import type { SigningCapability, SigningCounters } from "@/lib/agent/client";

export type EnrollmentUIState =
  | "unknown"                // not yet checked
  | "no_browser_key"         // FC may be enrolled or not; this browser has no key
  | "pending_fc_online"      // browser has a key, waiting for drone to come online to enroll FC
  | "enrolled"               // browser key matches FC, signed frames flowing
  | "fc_rejected"            // FC rejected our key (key mismatch, manual intervention needed)
  | "key_missing";           // FC requires signing but this browser has no key

export interface DroneSigningState {
  droneId: string;
  capability: SigningCapability | null;
  capabilityPolledAt: number | null;
  keyId: string | null;
  enrolledAt: string | null;
  requireOnFc: boolean | null;
  hasBrowserKey: boolean;
  enrollmentState: EnrollmentUIState;
  /** Signed frames we have emitted in this session. Incremented by the encoder. */
  txSignedCount: number;
  /**
   * Signed frames received from the FC.
   *
   * Observed, not verified: the parser reports that a frame carried the
   * MAVLINK_IFLAG_SIGNED bit and passed CRC. No HMAC is checked on the
   * receive path, because that needs the FC's key distributed to the agent
   * and no such distribution exists. Do not label this "verified" anywhere.
   */
  rxSignedCount: number;
  /** Wall-clock ms of the last accepted signed rx frame. */
  lastSignedFrameAt: number | null;
  /** Last agent-reported counters, polled. */
  agentCounters: SigningCounters | null;
}

interface SigningStoreState {
  // Per-drone state keyed by droneId.
  drones: Record<string, DroneSigningState>;

  // Selectors.
  get(droneId: string): DroneSigningState;

  // Mutations.
  setCapability(droneId: string, capability: SigningCapability): void;
  setBrowserKey(
    droneId: string,
    opts: {
      keyId: string;
      enrolledAt: string;
      enrollmentState: EnrollmentUIState;
    } | null,
  ): void;
  setRequireOnFc(droneId: string, require: boolean | null): void;
  setEnrollmentState(droneId: string, state: EnrollmentUIState): void;
  bumpTxSigned(droneId: string, n?: number): void;
  bumpRxSigned(droneId: string, n?: number): void;
  setAgentCounters(droneId: string, counters: SigningCounters): void;

  /** Drop every record. Used on sign-out / user-switch purge pairs. */
  clearAll(): void;
  /** Drop a single drone. */
  clearDrone(droneId: string): void;
}

function blankState(droneId: string): DroneSigningState {
  return {
    droneId,
    capability: null,
    capabilityPolledAt: null,
    keyId: null,
    enrolledAt: null,
    requireOnFc: null,
    hasBrowserKey: false,
    enrollmentState: "unknown",
    txSignedCount: 0,
    rxSignedCount: 0,
    lastSignedFrameAt: null,
    agentCounters: null,
  };
}

export const useSigningStore = create<SigningStoreState>()((set, get) => ({
  drones: {},

  get(droneId) {
    return get().drones[droneId] ?? blankState(droneId);
  },

  setCapability(droneId, capability) {
    set((s) => ({
      drones: {
        ...s.drones,
        [droneId]: {
          ...(s.drones[droneId] ?? blankState(droneId)),
          capability,
          capabilityPolledAt: Date.now(),
        },
      },
    }));
  },

  setBrowserKey(droneId, opts) {
    set((s) => {
      const prev = s.drones[droneId] ?? blankState(droneId);
      if (opts === null) {
        return {
          drones: {
            ...s.drones,
            [droneId]: {
              ...prev,
              keyId: null,
              enrolledAt: null,
              hasBrowserKey: false,
              enrollmentState: "no_browser_key",
            },
          },
        };
      }
      return {
        drones: {
          ...s.drones,
          [droneId]: {
            ...prev,
            keyId: opts.keyId,
            enrolledAt: opts.enrolledAt,
            hasBrowserKey: true,
            enrollmentState: opts.enrollmentState,
          },
        },
      };
    });
  },

  setRequireOnFc(droneId, require) {
    set((s) => ({
      drones: {
        ...s.drones,
        [droneId]: {
          ...(s.drones[droneId] ?? blankState(droneId)),
          requireOnFc: require,
        },
      },
    }));
  },

  setEnrollmentState(droneId, state) {
    set((s) => ({
      drones: {
        ...s.drones,
        [droneId]: {
          ...(s.drones[droneId] ?? blankState(droneId)),
          enrollmentState: state,
        },
      },
    }));
  },

  bumpTxSigned(droneId, n = 1) {
    set((s) => {
      const prev = s.drones[droneId] ?? blankState(droneId);
      return {
        drones: {
          ...s.drones,
          [droneId]: { ...prev, txSignedCount: prev.txSignedCount + n },
        },
      };
    });
  },

  bumpRxSigned(droneId, n = 1) {
    set((s) => {
      const prev = s.drones[droneId] ?? blankState(droneId);
      return {
        drones: {
          ...s.drones,
          [droneId]: {
            ...prev,
            rxSignedCount: prev.rxSignedCount + n,
            lastSignedFrameAt: Date.now(),
          },
        },
      };
    });
  },


  setAgentCounters(droneId, counters) {
    set((s) => ({
      drones: {
        ...s.drones,
        [droneId]: {
          ...(s.drones[droneId] ?? blankState(droneId)),
          agentCounters: counters,
        },
      },
    }));
  },

  clearAll() {
    set({ drones: {} });
  },

  clearDrone(droneId) {
    set((s) => {
      const next = { ...s.drones };
      delete next[droneId];
      return { drones: next };
    });
  },
}));
