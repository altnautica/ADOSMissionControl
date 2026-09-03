"use client";

/**
 * @module use-atlas-world-stream
 * @description Subscribes the paired compute node's per-device world-model
 * descriptor stream for one drone, and folds every frame into
 * `atlas-world-store`.
 *
 * The stream is the SHARED-DATA lane: the node publishes a splat / point-cloud /
 * mesh / occupancy descriptor per completed reconstruct generation at
 * `GET /ws/atlas/<droneDeviceId>` on its own engine listener, tagged with the
 * drone that captured it. Before this the four topics had a publisher on the
 * agent side and no subscriber anywhere in the GCS.
 *
 * The node the stream is read from is passed in rather than resolved here:
 * `use-drone-world-model` already owns compute-node selection (the node the
 * drone reports, else the newest-paired workstation), and a second resolver
 * would be a second answer to the same question.
 *
 * Every stand-down reason is recorded as a distinct status so the surface can
 * say WHY there is no stream, which is never the same statement as "this drone
 * has no world model":
 *
 *  - **demo** — there is no compute node, and fabricating descriptors would
 *    fabricate a world.
 *  - **no-node** — nothing paired to stream from.
 *  - **blocked-origin** — a browser on an HTTPS origin cannot open a plain-`ws`
 *    LAN socket, and unlike the job API this lane has no server-side proxy, so
 *    the honest report is that the transport is unavailable on this origin.
 *
 * @license GPL-3.0-only
 */

import { useEffect } from "react";

import { subscribeWorldStream, worldStreamUrl } from "@/lib/atlas/world-stream";
import { deviceIdFromNodeId } from "@/lib/agent/node-id";
import { isDemoMode } from "@/lib/utils";
import { useAtlasWorldStore } from "@/stores/atlas-world-store";
import { useLocalNodesStore } from "@/stores/local-nodes-store";

/**
 * Mount the descriptor stream for `droneDeviceId` off the compute node
 * `computeNodeId`, writing into `atlas-world-store`. Inert (status recorded, no
 * socket) when either id is missing, in demo, or on an HTTPS origin.
 *
 * @param droneDeviceId The capturing drone's device id — the stream path AND the
 *   store key, so one node serving several drones never cross-talks.
 * @param computeNodeId The reconstructor node's device id, from
 *   `useDroneWorldModel().computeNodeDeviceId`.
 */
export function useAtlasWorldStream(
  droneDeviceId: string | null | undefined,
  computeNodeId: string | null | undefined,
): void {
  const nodeDeviceId = computeNodeId
    ? (deviceIdFromNodeId(computeNodeId) ?? computeNodeId)
    : null;
  const nodeHost = useLocalNodesStore((s) =>
    nodeDeviceId
      ? s.nodes.find((n) => n.deviceId === nodeDeviceId)?.hostname
      : undefined,
  );
  const drone = droneDeviceId
    ? (deviceIdFromNodeId(droneDeviceId) ?? droneDeviceId)
    : null;

  useEffect(() => {
    if (!drone) return;
    const { applyFrame, setStatus } = useAtlasWorldStore.getState();
    if (isDemoMode()) {
      setStatus(drone, "demo");
      return;
    }
    if (!nodeHost) {
      setStatus(drone, "no-node");
      return;
    }
    const url = worldStreamUrl(nodeHost, drone);
    if (!url) {
      setStatus(drone, "no-node");
      return;
    }
    // The descriptor lane has no `/api/lan-pair/*` proxy, so a hosted HTTPS GCS
    // cannot reach a plain-`ws` LAN node at all — the browser blocks it as
    // mixed content before the socket opens. Saying so beats an endless
    // reconnect against a transport that cannot work on this origin.
    if (
      typeof window !== "undefined" &&
      window.location.protocol === "https:" &&
      url.startsWith("ws:")
    ) {
      setStatus(drone, "blocked-origin");
      return;
    }
    return subscribeWorldStream({
      url,
      onFrame: (frame) => applyFrame(drone, frame, Date.now()),
      onState: (state) => setStatus(drone, state),
    });
  }, [drone, nodeHost]);

  // Stand the status down on unmount so a closed surface never reads as a live
  // stream. The generation itself is retained: the world model a node published
  // is still the newest thing known about this drone.
  useEffect(() => {
    if (!drone) return;
    return () => useAtlasWorldStore.getState().setStatus(drone, "idle");
  }, [drone]);
}
