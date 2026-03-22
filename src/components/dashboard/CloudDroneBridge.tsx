"use client";

/**
 * @module CloudDroneBridge
 * @description Bridges cloud-paired ADOS agents into the Dashboard fleet store.
 * Queries Convex for paired drones and their cloud status, then adds them
 * as FleetDrone entries with source="cloud". Handles staleness detection
 * to remove offline agents from the fleet view.
 * @license GPL-3.0-only
 */

import { useEffect, useRef } from "react";
import { useQuery } from "convex/react";
import { useFleetStore } from "@/stores/fleet-store";
import { cmdDronesApi, cmdDroneStatusApi } from "@/lib/community-api-drones";
import { useConvexAvailable } from "@/app/ConvexClientProvider";
import { isDemoMode } from "@/lib/utils";
import type { FleetDrone } from "@/lib/types";

const CLOUD_STALE_MS = 60_000; // Consider drone offline after 60s without update

export function CloudDroneBridge() {
  const convexAvailable = useConvexAvailable();
  const demo = isDemoMode();
  const trackedIds = useRef<Set<string>>(new Set());

  const myDrones = useQuery(
    cmdDronesApi.listMyDrones,
    !demo && convexAvailable ? {} : "skip"
  );

  useEffect(() => {
    if (!myDrones || !Array.isArray(myDrones)) return;

    const fleet = useFleetStore.getState();
    const now = Date.now();
    const currentCloudIds = new Set<string>();

    for (const drone of myDrones) {
      const fleetId = `cloud-${drone.deviceId}`;
      currentCloudIds.add(fleetId);

      // Check if drone is online (lastSeen within threshold)
      const lastSeen = drone.lastSeen ?? 0;
      const isOnline = now - lastSeen < CLOUD_STALE_MS;

      if (!isOnline) {
        // Remove stale cloud drone from fleet
        if (trackedIds.current.has(fleetId)) {
          fleet.removeDrone(fleetId);
          trackedIds.current.delete(fleetId);
        }
        continue;
      }

      const fleetDrone: FleetDrone = {
        id: fleetId,
        name: drone.name || `Agent ${drone.deviceId.slice(0, 8)}`,
        status: isOnline ? "online" : "offline",
        connectionState: isOnline ? "connected" : "disconnected",
        flightMode: "STABILIZE",
        armState: "disarmed",
        lastHeartbeat: lastSeen,
        firmwareVersion: drone.agentVersion,
        healthScore: isOnline ? 80 : 0,
        hasAgent: true,
        source: "cloud",
        cloudDeviceId: drone.deviceId,
      };

      if (trackedIds.current.has(fleetId)) {
        // Update existing cloud drone
        fleet.updateDrone(fleetId, fleetDrone);
      } else {
        // Add new cloud drone
        fleet.addDrone(fleetDrone);
        trackedIds.current.add(fleetId);
      }
    }

    // Remove tracked cloud drones that no longer exist in paired list
    for (const id of trackedIds.current) {
      if (!currentCloudIds.has(id)) {
        fleet.removeDrone(id);
        trackedIds.current.delete(id);
      }
    }
  }, [myDrones]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      const fleet = useFleetStore.getState();
      for (const id of trackedIds.current) {
        fleet.removeDrone(id);
      }
      trackedIds.current.clear();
    };
  }, []);

  return null; // Pure bridge, no UI
}
