"use client";

/**
 * @module atlas-world-store
 * @description Per-device world-model descriptor state, fed by the compute
 * node's per-device descriptor stream (`GET /ws/atlas/<deviceId>`).
 *
 * This is the SHARED-DATA half of Atlas, distinct from `atlas-store`: that store
 * holds the drone's own capture facts (session, keyframes, VIO health, bearer),
 * while this one holds what a compute node reconstructed FROM those keyframes —
 * the splat / point cloud / mesh / occupancy descriptors of the newest
 * generation. Keyed by device because one compute node serves several drones and
 * a descriptor is tagged with the drone it belongs to, so one drone's world must
 * never appear in another's view.
 *
 * Frames are handed in as raw bytes rather than decoded values, so the envelope
 * check, the descriptor decode and the refusal accounting live in exactly one
 * place and are testable without a socket.
 *
 * A descriptor arrives roughly once per reconstruct generation (tens of seconds
 * apart, four events per generation), not at telemetry rate, so a shallow
 * per-device map clone per frame is the right cost here — the rAF-coalescing
 * discipline that live telemetry stores need would add a frame of latency for
 * no saved renders.
 *
 * @license GPL-3.0-only
 */

import { create } from "zustand";

import { decodeAtlasEvent } from "@/lib/atlas/world-contract";
import { decodeWorldDescriptor } from "@/lib/atlas/world-descriptors";
import {
  applyWorldArtifact,
  type WorldModelGeneration,
} from "@/lib/atlas/world-generation";

/** Why the descriptor stream is or is not running for a device. Each value is a
 * distinct operator-facing cause; none of them is "no world model", which is a
 * statement about the DATA and lives in the generation slice. */
export type WorldStreamStatus =
  /** Nothing is subscribing (the surface is not mounted). */
  | "idle"
  /** No compute node is paired, so there is no stream to open. */
  | "no-node"
  /** Demo mode: no compute node exists, so no descriptors are fabricated. */
  | "demo"
  /** A browser on an HTTPS origin cannot open a plain-WS LAN socket, and the
   * descriptor stream has no server-side proxy. */
  | "blocked-origin"
  | "connecting"
  | "connected"
  | "reconnecting";

/** One device's world-model state. */
export interface DeviceWorldState {
  /** The newest generation's artifact set, or null when the compute node has
   * published none — which means NO world model, not an empty one. */
  generation: WorldModelGeneration | null;
  status: WorldStreamStatus;
  /** Epoch ms the last descriptor was accepted, or null. */
  lastDescriptorAt: number | null;
  /** Descriptors accepted (opened or folded) since the slice was created. */
  acceptedDescriptors: number;
  /** Descriptors dropped for naming an older generation of the same session. */
  supersededDescriptors: number;
  /** Frames whose envelope did not decode as msgpack. */
  malformedFrames: number;
  /** Frames that decoded but were not a usable envelope / descriptor. */
  shapeRejectedFrames: number;
  /** Frames refused for an envelope version this build does not speak. */
  versionRejectedFrames: number;
  /** The newest refused envelope version, so a surface can name it. */
  rejectedVersion: number | null;
  /** Frames on a topic that is not a world-model artifact topic (the pose lane
   * and any future topic ride the same socket). */
  offTopicFrames: number;
}

export const EMPTY_DEVICE_WORLD: DeviceWorldState = {
  generation: null,
  status: "idle",
  lastDescriptorAt: null,
  acceptedDescriptors: 0,
  supersededDescriptors: 0,
  malformedFrames: 0,
  shapeRejectedFrames: 0,
  versionRejectedFrames: 0,
  rejectedVersion: null,
  offTopicFrames: 0,
};

export interface AtlasWorldState {
  devices: Record<string, DeviceWorldState>;
  /** Fold one raw stream frame into `deviceId`'s slice. */
  applyFrame: (deviceId: string, frame: Uint8Array, nowMs: number) => void;
  setStatus: (deviceId: string, status: WorldStreamStatus) => void;
  clearDevice: (deviceId: string) => void;
  clear: () => void;
}

export const useAtlasWorldStore = create<AtlasWorldState>((set) => ({
  devices: {},

  applyFrame: (deviceId, frame, nowMs) =>
    set((s) => {
      const prev = s.devices[deviceId] ?? EMPTY_DEVICE_WORLD;
      const decoded = decodeAtlasEvent(frame);
      if (!decoded.ok) {
        const next: DeviceWorldState = { ...prev };
        if (decoded.reason === "malformed") next.malformedFrames += 1;
        else if (decoded.reason === "version") {
          next.versionRejectedFrames += 1;
          next.rejectedVersion = decoded.version;
        } else next.shapeRejectedFrames += 1;
        return { devices: { ...s.devices, [deviceId]: next } };
      }
      const artifact = decodeWorldDescriptor(
        decoded.event.topic,
        decoded.event.payload,
      );
      if (!artifact) {
        return {
          devices: {
            ...s.devices,
            [deviceId]: { ...prev, offTopicFrames: prev.offTopicFrames + 1 },
          },
        };
      }
      const applied = applyWorldArtifact(prev.generation, artifact, nowMs);
      if (applied.application === "superseded") {
        return {
          devices: {
            ...s.devices,
            [deviceId]: {
              ...prev,
              supersededDescriptors: prev.supersededDescriptors + 1,
            },
          },
        };
      }
      return {
        devices: {
          ...s.devices,
          [deviceId]: {
            ...prev,
            generation: applied.generation,
            lastDescriptorAt: nowMs,
            acceptedDescriptors: prev.acceptedDescriptors + 1,
          },
        },
      };
    }),

  setStatus: (deviceId, status) =>
    set((s) => {
      const prev = s.devices[deviceId] ?? EMPTY_DEVICE_WORLD;
      if (prev.status === status) return s;
      return { devices: { ...s.devices, [deviceId]: { ...prev, status } } };
    }),

  clearDevice: (deviceId) =>
    set((s) => {
      if (!(deviceId in s.devices)) return s;
      const devices = { ...s.devices };
      delete devices[deviceId];
      return { devices };
    }),

  clear: () => set({ devices: {} }),
}));

/** A zustand selector over the world store. Named so a consumer imports the
 * contract rather than inferring it from the factory. */
export type DeviceWorldSelector = (s: AtlasWorldState) => DeviceWorldState;

/**
 * Select one device's world state. Returns the shared empty slice for an
 * unknown device so the reference is stable and a subscriber does not re-render
 * on every unrelated device's frame.
 */
export function selectDeviceWorld(
  deviceId: string | null | undefined,
): DeviceWorldSelector {
  return (s) => (deviceId ? s.devices[deviceId] : undefined) ?? EMPTY_DEVICE_WORLD;
}
